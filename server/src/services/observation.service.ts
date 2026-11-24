import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import {
  CHECK_RESULTS,
  COPE_DIMENSIONS,
  copeDimensionsOf,
  ObservationModel,
  SEVERITIES,
  type CopeDimension,
  type IInterpretation,
  type IPage,
  type IPhoto,
  type IPhotoRegion,
  type IRecording,
  type IStamp,
  type CheckResult,
  type IChecklistLink,
  type ISuggestion,
  type Severity,
  OBSERVATION_KINDS,
  type ObservationKind,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError, opensAssessment } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { locationText, toLocationDto, type LocationDto } from './location.service'
import { onTranscriptionJob, transcriptionQueue } from './background-queues.service'
import { defineQueue, retryJobId, type JobContext } from './job-queue.service'
import { publishObservations } from './assistant/bus'
import { queueAssessmentCheck } from './assistant/check-queue.service'
import { duplicateKeyField } from './mongo-errors'
import {
  interpretationFailureReason,
  kept,
  photoReadingOf,
  photosOutOfDate,
  queueReading,
  type StoredObservation,
} from './observation-reading.service'
import {
  SpeechServiceError,
  transcribe,
  transcribeHandwriting,
  transcriptionFailureReason,
} from './speech.service'
import * as storage from './storage.service'
import type { ByteRange } from './storage.service'

export class NoActiveSessionError extends Error {
  constructor(reference: string) {
    super(`${reference} has no capture session in progress. Open Site observation to start one.`)
    this.name = 'NoActiveSessionError'
  }
}
export class ObservationNotFoundError extends Error {
  constructor(what = 'observation') {
    super(`The ${what} was not found.`)
    this.name = 'ObservationNotFoundError'
  }
}
export class UnknownLocationError extends Error {
  constructor() {
    super('Choose one of the locations listed for this assessment.')
    this.name = 'UnknownLocationError'
  }
}
export class NotRetryableError extends Error {
  constructor(message = 'Only a failed transcription can be retried.') {
    super(message)
    this.name = 'NotRetryableError'
  }
}
// The observation isn't in the state the change needs (CP-08), e.g. deleted.
export class ObservationStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObservationStateError'
  }
}
// The checklist item an observation was to check can't take it (CP-31): it is
// not on the latest checklist, e.g. one regenerated meanwhile, or another
// observation checks it already.
export class ChecklistItemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistItemError'
  }
}
// Removing the note, a recording, a photo or a page would leave the
// observation with nothing captured (CP-08, CP-20).
export class EmptyObservationError extends Error {
  constructor(what: 'note' | 'recording' | 'photo' | 'page' = 'note') {
    super(
      `An observation needs a note, a recording, a photo or a page, so this ${what} can’t be removed.` +
        (what === 'note' ? '' : ' Add what replaces it first.'),
    )
    this.name = 'EmptyObservationError'
  }
}

const DELETED = 'This observation is deleted. Restore it before changing it.'

// Whisper picks the decoder from the file extension, so the S3 key carries one.
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
}
export function audioExtension(contentType: string): string | undefined {
  return EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()]
}

// A photo's format comes from its first bytes, not the type the browser
// reports, so a HEIC renamed .jpg is refused rather than stored (CP-04 AC4).
const JPEG = Buffer.from([0xff, 0xd8, 0xff])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export function photoFormat(image: Buffer) {
  if (image.subarray(0, JPEG.length).equals(JPEG))
    return { contentType: 'image/jpeg' as const, extension: 'jpg' }
  if (image.subarray(0, PNG.length).equals(PNG))
    return { contentType: 'image/png' as const, extension: 'png' }
  return undefined
}

// The tags, shared by capture and by later tag edits so both accept only the
// shared vocabulary (CP-06 AC3).
// The COPE categories: one or more, kept in C-O-P-E order without repeats so
// the same choice always saves the same list, and none (null or []) saved as
// null, uncategorised.
// Checked as a whole, so a wrong value is reported against copeDimensions.
const copeDimensionsField = z
  .array(z.string(), 'Choose COPE categories as a list, or null to leave it uncategorised.')
  .nullable()
  .refine(
    (list) => !list || list.every((d) => (COPE_DIMENSIONS as readonly string[]).includes(d)),
    'Choose COPE categories from Construction, Occupancy, Protection and Exposure.',
  )
  .transform((list) => {
    const chosen = COPE_DIMENSIONS.filter((d) => list?.includes(d))
    return chosen.length ? chosen : null
  })
const severityField = z.enum(SEVERITIES, 'Choose a severity: critical, high, moderate or low.')
const locationIdField = z
  .string('Choose a location.')
  .refine(isValidObjectId, 'Choose one of the locations listed for this assessment.')
const standardField = z.string().trim().max(100, 'Standard must be 100 characters or fewer.')

// One to three tags, in a fixed order with repeats dropped; an empty list or an unknown tag is refused.
const kindsField = z
  .array(
    z.enum(OBSERVATION_KINDS, 'An observation is a fact, an info request or a recommendation.'),
  )
  .min(1, 'Choose at least one tag.')
  .transform((list) => OBSERVATION_KINDS.filter((k) => list.includes(k)))

// Up to 8 labels of 1 to 30 characters, trimmed, repeats (ignoring case) dropped. They only sort
// the list (CP-36).
const labelsField = z
  .array(
    z.string().trim().min(1, 'A label needs a word.').max(30, 'A label is 30 characters or fewer.'),
  )
  .max(8, 'An observation can have at most 8 labels.')
  .transform((list) =>
    list.filter((l, n) => list.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === n),
  )

// The fields of POST /api/assessments/:reference/observations, sent as the
// form's `details` part alongside any recordings.
// Attribution comes from the authenticated session, never from these fields.
export const newObservationSchema = z.object({
  // Stored exactly as written (CP-02 AC1); a blank note counts as none.
  note: z
    .string()
    .max(5000, 'The note must be 5,000 characters or fewer.')
    .optional()
    .transform((note) => (note?.trim() ? note : undefined)),

  // The engineer's tags (CP-36); absent means Fact. The note stays as typed.
  kinds: kindsField.optional(),
  labels: labelsField.optional(),

  // null, [] or absent leaves it uncategorised (CP-02 AC4), for the AI to
  // suggest (CP-24); a severity left null or absent likewise.
  copeDimensions: copeDimensionsField.optional().transform((list) => list ?? null),
  severity: severityField
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  locationId: locationIdField,
  // The draft observation holding the recordings made before Save (CP-24): it
  // becomes this observation.
  draftId: z.string().refine(isValidObjectId, 'This draft observation was not found.').optional(),
  standard: standardField.optional().transform((value) => value || undefined),
  // The checklist item it answers (CP-31), when saved from the checklist.
  checklistItem: z
    .object({
      itemId: z.string().refine(isValidObjectId, 'Choose an item on the checklist.'),
      result: z.enum(CHECK_RESULTS, 'Answer the item as confirmed or differs.'),
    })
    .optional(),
})
export type ObservationDetails = z.infer<typeof newObservationSchema>

// The body of PATCH /api/observations/:id: its tags (CP-06) and note (CP-08).
// A field left out stays as it is; null or [] uncategorises the observation, and
// null or '' removes the standard. The note is stored exactly as written, and
// null or a blank one removes it.
// Sending a category or severity makes it the engineer's (CP-24): its
// suggestion's not-sure mark clears, even for the same value. `confirm` keeps
// the values named as they are and clears their marks. null empties severity.
export const observationChangesSchema = z.object({
  // The checklist item this observation answers (CP-37): link it, or null to unlink.
  checklistItem: z
    .object({
      itemId: z.string().refine(isValidObjectId, 'Choose an item on the checklist.'),
      result: z.enum(CHECK_RESULTS, 'Answer the item as confirmed or differs.'),
    })
    .nullable()
    .optional(),
  // null clears the tags (back to Fact).
  kinds: kindsField.nullable().optional(),
  // null or [] clears the labels.
  labels: labelsField.nullable().optional(),
  // true marks the info request asked; false clears the mark.
  asked: z.boolean().optional(),
  copeDimensions: copeDimensionsField.optional(),
  severity: severityField.nullable().optional(),
  confirm: z
    .array(z.enum(['category', 'severity'], 'Confirm the category or the severity.'))
    .optional(),
  locationId: locationIdField.optional(),
  standard: standardField
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
  note: z
    .string()
    .max(5000, 'The note must be 5,000 characters or fewer.')
    .nullable()
    .optional()
    .transform((note) => (note === undefined ? undefined : note?.trim() ? note : null)),
})
export type ObservationChanges = z.infer<typeof observationChangesSchema>

// The body of PUT /api/observations/:id/recordings/:recordingId/transcript
// (CP-08): the corrected transcript, stored exactly as written.
export const transcriptCorrectionSchema = z.object({
  text: z
    .string('Write the corrected transcript.')
    .max(20000, 'The transcript must be 20,000 characters or fewer.')
    .refine((text) => text.trim() !== '', 'Write the corrected transcript.'),
})
// A marked area of a photo (CP-10): fractions of its width and height, with a
// size, inside the photo.
const fraction = z.number('Give each side as a number from 0 to 1.').min(0).max(1)
export const photoRegionSchema = z
  .object({ x: fraction, y: fraction, w: fraction, h: fraction })
  .refine((r) => r.w > 0 && r.h > 0, 'Mark an area, not a point or a line.')
  .refine((r) => r.x + r.w <= 1 && r.y + r.h <= 1, 'Mark an area inside the photo.')
export type NewRecording = { name: string; audio: Buffer; contentType: string }
// The route has already checked it is a JPG or PNG (photoFormat).
// `region` is an area the engineer marked before saving it (CP-10).
export type NewPhoto = { name: string; image: Buffer; region?: IPhotoRegion }
// A handwritten page (CP-19), checked as a photo is.
export type NewPage = { name: string; image: Buffer }

// Who did something and when, for the DTO.
type StampDto = { at: Date; by: { id: string; name: string } }
const stampDto = (stamp?: IStamp): StampDto | null =>
  stamp ? { at: stamp.at, by: { id: stamp.by.id, name: stamp.by.name } } : null

type RecordingDto = {
  type: 'Voice'
  id: string
  name: string
  contentType: string
  size: number
  url: string
  transcription: {
    status: IRecording['transcription']['status']
    // As Whisper wrote it, kept even once corrected.
    transcript: string | null
    // The engineer's correction, which drafting uses (CP-08).
    correction: (StampDto & { text: string }) | null
    error: string | null
    attempts: number
  }
  // Who added it after the observation was saved (CP-08).
  added: StampDto | null
  // Present when this is the part of a site walk recording it came from
  // (CP-22); play `url` with the media fragment #t=start,end.
  clip?: { siteWalk: string; start: number; end: number }
}
// Each links to its original image (CP-04 AC2).
type PhotoDto = {
  type: 'Photo'
  id: string
  name: string
  contentType: IPhoto['contentType']
  size: number
  url: string
  // How it last went to the model with protection on (PV-04): the faces
  // blurred, and a link to that copy (null when it had none, so went as
  // taken); null when never read with protection on.
  redaction: { url: string | null; faces: number } | null
  // The area the engineer marked (CP-10), or null when none is.
  region: IPhotoRegion | null
  added: StampDto | null
}
// A handwritten page (CP-19), linking to its original photo.
type PageDto = {
  type: 'Scan'
  id: string
  name: string
  contentType: IPage['contentType']
  size: number
  url: string
  transcription: {
    status: IPage['transcription']['status']
    // The handwriting word for word; '' when the page has none.
    transcript: string | null
    // The words the model was unsure of, [start, end) in `transcript`.
    uncertain: [number, number][]
    error: string | null
    attempts: number
    // The model that wrote it.
    model: string | null
    // The engineer's correction, which drafting uses (CP-20).
    correction: (StampDto & { text: string }) | null
  }
  // Who added it after the observation was saved (CP-20).
  added: StampDto | null
}

export type ObservationDto = {
  id: string
  engineer: string
  engineerId: string | null
  // Its categories in C-O-P-E order; null when not categorised yet.
  copeDimensions: CopeDimension[] | null
  standard: string | null
  // null while empty (CP-24).
  severity: Severity | null
  // null only if the location is no longer listed, or on a draft observation.
  location: LocationDto | null
  note: string | null
  // The engineer's tags (CP-36); null when untagged, which reads as Fact.
  kinds: ObservationKind[] | null
  // Sort-only labels (CP-36), and whether the client has been asked for it.
  labels: string[]
  asked: boolean
  // Its evidence: the recordings and photos not removed. Everything that
  // reads these, drafting included, leaves removed ones out (CP-08).
  recordings: RecordingDto[]
  photos: PhotoDto[]
  // Its handwritten pages (CP-19) not removed (CP-20), in the order they were saved.
  pages: PageDto[]
  // Removed ones, with who removed them and when, to restore (CP-08, CP-20).
  removedRecordings: (RecordingDto & { removed: StampDto })[]
  removedPhotos: (PhotoDto & { removed: StampDto })[]
  removedPages: (PageDto & { removed: StampDto })[]
  // Its photos' description (CP-05, CP-21), written without asking since
  // CP-24; null until they are first described.
  interpretation: {
    photos: {
      status: NonNullable<IInterpretation['status']>
      description: string | null
      hazardType: string | null
      error: string | null
      attempts: number
      model: string | null
      // The photos it describes, removed ones included.
      photoIds: string[]
      // Finished, but of photos or marks other than those it has now.
      outOfDate: boolean
    } | null
  } | null
  // The AI's suggestions (CP-24); null when nothing is suggested and nothing
  // is running. A field's entry is present while its value is an unconfirmed
  // suggestion; null once it is the engineer's, or while it is empty.
  suggestion: {
    status: ISuggestion['status']
    // Short reason when failed.
    error: string | null
    category: { notSure: boolean } | null
    severity: { notSure: boolean } | null
  } | null
  // Left out of drafting until settled (CP-24): category or severity empty,
  // a not-sure value, or a failed suggestion. The one shared rule.
  toCheck: boolean
  // The checklist item it answers (CP-31), with the item's text then; null
  // when it was captured on its own.
  checklistItem: { itemId: string; result: CheckResult; text: string } | null
  // When it was captured (CP-02 AC2).
  // Created from a site walk proposal (CP-22 round 3), for the "From site walk" mark.
  fromSiteWalk: boolean
  recordedAt: Date
  // The latest change to its tags, note, a transcript, or its recordings and
  // photos (CP-08).
  edited: StampDto | null
  // Set while it is deleted (CP-08).
  deleted: StampDto | null
}

// The same for a handwritten page (CP-19), from S5's message prefixes
// (microservices/speech-ocr-service/app/processors/handwriting.py).
function pageFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The page could not be read from storage:'))
    return 'The page could not be read from storage.'
  if (error.startsWith('The page could not be opened:')) return 'The page could not be opened.'
  if (error.startsWith('The page could not be transcribed:')) {
    // The provider's own status, when it says why: retrying at once won't help a
    // used-up limit, and will soon help a busy service.
    if (/Error code: 429|rate limit|quota/i.test(error))
      return 'The handwriting service has reached its usage limit. Try again later.'
    if (/Error code: 503|high demand|overloaded/i.test(error))
      return 'The handwriting service is busy. Try again in a minute.'
    if (/timed? ?out/i.test(error)) return 'The handwriting service took too long to answer.'
    return 'The handwriting service could not transcribe the page.'
  }
  return error.length > 200 ? 'Transcription failed. Please retry or contact support.' : error
}

// The photos' description as the DTO gives it (CP-21); null until described.
function interpretationDto(o: StoredObservation): ObservationDto['interpretation'] {
  if (!o.interpretation) return null
  const photos = photoReadingOf(o)
  return {
    photos: photos && {
      status: photos.status,
      description: photos.description ?? null,
      hazardType: photos.hazardType ?? null,
      error: interpretationFailureReason(photos.error),
      attempts: photos.attempts.length,
      model: photos.provenance?.model ?? null,
      photoIds: photos.photoIds.map(String),
      outOfDate: photosOutOfDate(o),
    },
  }
}

// The suggestions as the DTO gives them (CP-24): null when there is nothing to
// show, i.e. done with no field still a suggestion (or a stored entry with no
// status, which an engineer's change can leave before any run).
function suggestionDto(s: ISuggestion | undefined): ObservationDto['suggestion'] {
  if (!s?.status) return null
  if (s.status === 'done' && !s.category && !s.severity) return null
  return {
    status: s.status,
    error: s.error ?? null,
    category: s.category ? { notSure: s.category.notSure } : null,
    severity: s.severity ? { notSure: s.severity.notSure } : null,
  }
}

/** Returns whether an observation is to check (CP-24), the rule drafting also uses. */
export function isToCheck(o: StoredObservation): boolean {
  const s = o.suggestion?.status ? o.suggestion : undefined
  return (
    !copeDimensionsOf(o.metadata.COPE_dimension) ||
    !o.severity ||
    !!s?.category?.notSure ||
    !!s?.severity?.notSure ||
    s?.status === 'failed'
  )
}

function toDto(o: StoredObservation, locations: ILocation[]): ObservationDto {
  const location = o.location && locations.find((l) => l._id.equals(o.location))
  const recording = (r: IRecording): RecordingDto => ({
    type: 'Voice',
    id: String(r._id),
    name: r.name,
    contentType: r.contentType,
    size: r.size,
    url: `/api/observations/${o._id}/recordings/${r._id}/audio`,
    transcription: {
      status: r.transcription.status,
      transcript: r.transcription.transcript ?? null,
      correction: r.transcription.correction
        ? { text: r.transcription.correction.text, ...stampDto(r.transcription.correction)! }
        : null,
      error: transcriptionFailureReason(r.transcription.error),
      attempts: r.transcription.attempts.length,
    },
    added: stampDto(r.added),
    ...(r.clip && {
      clip: { siteWalk: String(r.clip.siteWalk), start: r.clip.start, end: r.clip.end },
    }),
  })
  const photo = (p: IPhoto): PhotoDto => ({
    type: 'Photo',
    id: String(p._id),
    name: p.name,
    contentType: p.contentType,
    size: p.size,
    url: `/api/observations/${o._id}/photos/${p._id}/image`,
    redaction: p.redaction
      ? {
          url: p.redaction.key && `/api/observations/${o._id}/photos/${p._id}/redacted`,
          faces: p.redaction.faces,
        }
      : null,
    region: p.region ? { x: p.region.x, y: p.region.y, w: p.region.w, h: p.region.h } : null,
    added: stampDto(p.added),
  })
  const page = (p: IPage): PageDto => ({
    type: 'Scan',
    id: String(p._id),
    name: p.name,
    contentType: p.contentType,
    size: p.size,
    url: `/api/observations/${o._id}/pages/${p._id}/image`,
    transcription: {
      status: p.transcription.status,
      transcript: p.transcription.transcript ?? null,
      uncertain: p.transcription.uncertain ?? [],
      error: pageFailureReason(p.transcription.error),
      attempts: p.transcription.attempts.length,
      model: p.transcription.provenance?.model ?? null,
      correction: p.transcription.correction
        ? { text: p.transcription.correction.text, ...stampDto(p.transcription.correction)! }
        : null,
    },
    added: stampDto(p.added),
  })
  const photos = o.photos ?? []
  const keptPhotos = kept(photos)
  const pages = o.pages ?? []
  return {
    id: String(o._id),
    engineer: o.engineer,
    engineerId: o.engineerId ? String(o.engineerId) : null,
    copeDimensions: copeDimensionsOf(o.metadata.COPE_dimension),
    standard: o.standard ?? null,
    severity: o.severity ?? null,
    location: location ? toLocationDto(location) : null,
    note: o.note ?? null,
    kinds: o.kinds ?? null,
    labels: o.labels ?? [],
    asked: !!o.asked,
    recordings: kept(o.recordings).map(recording),
    photos: keptPhotos.map(photo),
    pages: kept(pages).map(page),
    removedRecordings: o.recordings
      .filter((r) => r.removed)
      .map((r) => ({ ...recording(r), removed: stampDto(r.removed)! })),
    removedPhotos: photos
      .filter((p) => p.removed)
      .map((p) => ({ ...photo(p), removed: stampDto(p.removed)! })),
    removedPages: pages
      .filter((p) => p.removed)
      .map((p) => ({ ...page(p), removed: stampDto(p.removed)! })),
    interpretation: interpretationDto(o),
    suggestion: suggestionDto(o.suggestion),
    toCheck: isToCheck(o),
    checklistItem: o.checklistItem
      ? {
          itemId: String(o.checklistItem.item),
          result: o.checklistItem.result,
          text: o.checklistItem.text,
        }
      : null,
    // Older walk observations predate the field; their clip still names the walk.
    fromSiteWalk: Boolean(o.siteWalk) || o.recordings.some((r) => r.clip),
    recordedAt: o.createdAt,
    edited: stampDto(o.edited),
    deleted: stampDto(o.deleted),
  }
}

// The assessment, with its site, and the capture session in progress that a
// new observation is recorded against. Only an active session accepts one, and
// only from the assigned engineer while the assessment is not archived, as for
// changing an observation (CP-08 AC17, CP-31 AC8): a session opened before the
// assessment was archived stays active.
async function activeCapture(reference: string, user: SessionUser) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError('Only the engineer assigned to this assessment can capture for it.')
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  const session = await CaptureSessionModel.findOne({
    assessment: assessment._id,
    status: 'active',
  }).lean()
  if (!session) throw new NoActiveSessionError(reference)
  return { assessment, session }
}

// Saves one observation with its note, recordings, photos and handwritten pages
// against the assessment's active capture session. Each recording, photo and
// page goes to S3 as raw evidence (CP-03 AC1, CP-04 AC1, CP-19 AC1), and each
// recording and page starts its initial transcription (CP-03 AC3, CP-19 AC6).
// With `draftId`, the draft observation holding the recordings made before
// Save becomes this one, keeping them and their transcripts (CP-24). Then the
// reading job is queued: it describes the photos and suggests what the
// engineer left empty (CP-24). The session stays active, so the engineer can
// keep adding observations.
export async function saveObservation(
  reference: string,
  details: ObservationDetails,
  recordings: NewRecording[],
  user: SessionUser,
  photos: NewPhoto[] = [],
  pages: NewPage[] = [],
): Promise<ObservationDto> {
  const { assessment, session } = await activeCapture(reference, user)
  const locations = assessment.locations ?? []
  if (!locations.some((l) => l._id.equals(details.locationId))) throw new UnknownLocationError()
  const draft =
    details.draftId &&
    (await ObservationModel.findOne(
      { _id: details.draftId, assessment: assessment._id, draft: true },
      'recordings',
    ).lean<StoredObservation>())
  if (details.draftId && !draft) throw new ObservationNotFoundError('draft observation')
  // The draft's recordings count as captured; without any, the route's own check applied.
  const bringsNothing = !details.note && !recordings.length && !photos.length && !pages.length
  if (draft && bringsNothing && !kept(draft.recordings).length) throw new EmptyObservationError()
  const link = details.checklistItem && (await checklistLink(assessment._id, details.checklistItem))
  const id = draft ? draft._id : new Types.ObjectId()
  const now = new Date()
  const media = storedMedia(reference, id, { recordings, photos, pages }, now)
  const fields = {
    session: session._id,
    engineer: user.name,
    engineerId: user.id,
    note: details.note,
    ...(details.kinds && { kinds: details.kinds }),
    ...(details.labels?.length && { labels: details.labels }),
    standard: details.standard,
    severity: details.severity,
    location: details.locationId,
    ...(link && { checklistItem: link }),
    metadata: {
      source_type: 'observation' as const,
      jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
      facility_type: assessment.site?.facilityType ?? 'unknown',
      COPE_dimension: details.copeDimensions,
      effective_date: now,
    },
  }
  const observation = await withUploads(media.files, async () => {
    if (!draft)
      return (
        await ObservationModel.create({
          _id: id,
          assessment: assessment._id,
          ...fields,
          recordings: media.recordings,
          photos: media.photos,
          pages: media.pages,
        })
      ).toObject()
    // Recorded now, not when the first recording was added, so it lists in the
    // order saved. Matching on `draft` stops a discard or a second Save racing it.
    // When the Save brings nothing of its own, the draft must still hold a
    // recording: without this, one removed meanwhile would save an empty observation.
    const saved = await ObservationModel.findOneAndUpdate(
      { _id: id, draft: true, ...(bringsNothing && KEEPS_RECORDING) },
      {
        $set: { ...fields, createdAt: now },
        $unset: { draft: 1 },
        $push: {
          recordings: { $each: media.recordings },
          photos: { $each: media.photos },
          pages: { $each: media.pages },
        },
      },
      { returnDocument: 'after', overwriteImmutable: true },
    ).lean<StoredObservation>()
    if (!saved) {
      // Still a draft: its last recording went between the read and the write.
      if (await ObservationModel.exists({ _id: id, draft: true })) throw new EmptyObservationError()
      throw new ObservationNotFoundError('draft observation')
    }
    return saved
  })

  // The observation now checks the item, so a Not seen or Not applicable mark
  // on it no longer says anything.
  if (link) {
    await ChecklistModel.updateOne(
      { _id: link.checklist, 'items._id': link.item },
      { $set: { 'items.$.check': null } },
    )
  }

  for (const r of media.recordings) queueTranscription(String(id), String(r._id))
  for (const p of media.pages) void runPageTranscription(String(id), String(p._id))
  return toDto((await queueReading(id)) ?? observation, locations)
}

// The observations not deleted that check an item of the assessment's
// checklists (CP-31), oldest first, so a later one wins where two check the
// same item.
export async function checkingObservations(assessment: Types.ObjectId) {
  return ObservationModel.find({
    assessment,
    checklistItem: { $exists: true },
    deleted: { $exists: false },
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean<StoredObservation[]>()
}

// The link to the item of the assessment's latest checklist that a new
// observation answers (CP-31 AC2-3). The item must still be on that checklist,
// and no observation may check it already, under its id in this checklist or
// an earlier one it was carried from.
async function checklistLink(
  assessment: Types.ObjectId,
  input: NonNullable<ObservationDetails['checklistItem']>,
  // The observation being re-linked, which does not count as "another" one checking the item.
  except?: Types.ObjectId,
): Promise<IChecklistLink> {
  const checklist = await ChecklistModel.findOne({ assessment })
    .sort({ createdAt: -1, _id: -1 })
    .lean()
  const item = checklist?.items.find((i) => i._id.equals(input.itemId))
  if (!checklist || !item) {
    throw new ChecklistItemError(
      'This item is no longer on the checklist, which was regenerated. Remove the link to the checklist item to save the observation on its own, or reopen the checklist.',
    )
  }
  // Removed by the engineer (CP-32): restored first, it can be answered again.
  if (item.status === 'removed') {
    throw new ChecklistItemError(
      'This item was removed from the checklist. Restore it on the Checklist tab, or remove the link to save the observation on its own.',
    )
  }
  const checked = await ObservationModel.exists({
    assessment,
    'checklistItem.item': { $in: [item._id, ...(item.carried ?? [])] },
    deleted: { $exists: false },
    ...(except && { _id: { $ne: except } }),
  })
  if (checked) {
    throw new ChecklistItemError(
      'Another observation already checks this item. Delete that observation to check the item again, or remove the link to save this one on its own.',
    )
  }
  return { checklist: checklist._id, item: item._id, result: input.result, text: item.text }
}

// Recordings, photos and pages as an observation stores them, each with its own
// id and an S3 key in the observation's folder, and the files to upload. Each
// recording and page starts its one transcription attempt (CP-03 AC3, CP-19
// AC6). `added` marks recordings, photos and pages added after the observation
// was saved (CP-08, CP-20).
function storedMedia(
  reference: string,
  id: Types.ObjectId,
  {
    recordings,
    photos,
    pages = [],
  }: { recordings: NewRecording[]; photos: NewPhoto[]; pages?: NewPage[] },
  at: Date,
  added?: IStamp,
) {
  const storedRecordings = recordings.map((r) => {
    const recordingId = new Types.ObjectId()
    return {
      _id: recordingId,
      name: r.name,
      key: `audio/${reference}/${id}/${recordingId}.${audioExtension(r.contentType)}`,
      contentType: r.contentType,
      size: r.audio.length,
      transcription: { status: 'transcribing' as const, attempts: [{ startedAt: at }] },
      ...(added && { added }),
    }
  })
  const storedPhotos = photos.map((p) => {
    const photoId = new Types.ObjectId()
    const format = photoFormat(p.image)!
    return {
      _id: photoId,
      name: p.name,
      key: `photos/${reference}/${id}/${photoId}.${format.extension}`,
      contentType: format.contentType,
      size: p.image.length,
      ...(p.region && { region: p.region }),
      ...(added && { added }),
    }
  })
  const storedPages = pages.map((p) => {
    const pageId = new Types.ObjectId()
    const format = photoFormat(p.image)!
    return {
      _id: pageId,
      name: p.name,
      key: `pages/${reference}/${id}/${pageId}.${format.extension}`,
      contentType: format.contentType,
      size: p.image.length,
      transcription: { status: 'transcribing' as const, attempts: [{ startedAt: at }] },
      ...(added && { added }),
    }
  })
  const files = [
    ...storedRecordings.map((r, i) => ({
      key: r.key,
      body: recordings[i].audio,
      type: r.contentType,
    })),
    ...storedPhotos.map((p, i) => ({ key: p.key, body: photos[i].image, type: p.contentType })),
    ...storedPages.map((p, i) => ({ key: p.key, body: pages[i].image, type: p.contentType })),
  ]
  return { recordings: storedRecordings, photos: storedPhotos, pages: storedPages, files }
}

// Uploads the files to S3, then saves. There are no transactions on a
// standalone mongod, so if either fails the uploads are removed by hand.
async function withUploads<T>(
  files: { key: string; body: Buffer; type: string }[],
  save: () => Promise<T>,
): Promise<T> {
  try {
    await Promise.all(files.map((f) => storage.putObject(f.key, f.body, f.type)))
    return await save()
  } catch (error) {
    await Promise.all(files.map((f) => storage.deleteObject(f.key).catch(() => undefined)))
    throw error
  }
}

const stamp = (user: SessionUser): IStamp => ({
  at: new Date(),
  by: { id: user.id, name: user.name },
})

// Throws unless the user is the engineer assigned to the observation's assessment.
// For the changes that need no other check (a transcription retry): without it
// a knowledge admin, who holds assessments:edit (RV-11), could start work, and
// spend AI money, on someone else's assessment.
async function mustBeAssigned(id: string, user: SessionUser) {
  const observation = await ObservationModel.findById(id, 'assessment').lean()
  if (!observation) throw new ObservationNotFoundError()
  const assessment = await AssessmentModel.findById(observation.assessment, 'engineer').lean()
  if (String(assessment?.engineer) !== user.id) {
    throw new NotAssignedError(
      'Only the engineer assigned to this assessment can change its observations.',
    )
  }
}

// The observation, with its assessment's locations, when the user may change
// it (CP-08): only the assessment's assigned engineer, as for its other details
// (RV-10), and not once the assessment is archived.
async function changeable(id: string, user: SessionUser) {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findById(id).lean<StoredObservation>()
  if (!observation) throw new ObservationNotFoundError()
  const assessment = await AssessmentModel.findById(
    observation.assessment,
    'reference engineer archivedAt locations',
  ).lean()
  if (!assessment) throw new ObservationNotFoundError()
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError(
      'Only the engineer assigned to this assessment can change its observations.',
    )
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(assessment.reference)
  return { observation, locations: assessment.locations ?? [], reference: assessment.reference }
}

// Matches an observation keeping a recording, a photo or a handwritten page
// (CP-19) not removed (CP-08, CP-20).
const KEEPS_RECORDING = { recordings: { $elemMatch: { removed: { $exists: false } } } }
const KEEPS_PHOTO = { photos: { $elemMatch: { removed: { $exists: false } } } }
const KEEPS_PAGE = { pages: { $elemMatch: { removed: { $exists: false } } } }

// Changes an observation's tags (CP-06) and note (CP-08). The tags cover the
// note and every recording, so they are set once. Categorising an
// uncategorised observation brings it into drafting (CP-02 AC4). Only what
// differs is saved, with who changed it; a change to nothing records nothing.
// The value drafts cited stays in each draft's own `evidence` (CP-08 AC15).
// This is the one write path for category and severity (CP-24): choosing,
// changing or confirming one clears its suggestion entry, so the value is the
// engineer's and the reading job never replaces it.
export async function updateObservation(
  id: string,
  changes: ObservationChanges,
  user: SessionUser,
): Promise<ObservationDto> {
  const { observation: o, locations } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  if (changes.locationId && !locations.some((l) => l._id.equals(changes.locationId)))
    throw new UnknownLocationError()
  if (
    changes.note === null &&
    !kept(o.recordings).length &&
    !kept(o.photos ?? []).length &&
    !kept(o.pages ?? []).length
  )
    throw new EmptyObservationError()

  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  const change = (path: string, now: unknown, next: unknown) => {
    if (next === undefined || next === (now ?? null)) return
    if (next === null) unset[path] = 1
    else set[path] = next
  }
  // The fields now the engineer's. While a run is reading, the entry is cleared
  // even if it holds none yet, in case the run fills it before this lands.
  // shortcut: Confirm keeps whatever value is stored when it lands, not the one the engineer saw, if a
  // new suggestion arrives in the same instant; send the seen value with Confirm if that ever shows up.
  const owned = new Set(changes.confirm ?? [])
  if (changes.copeDimensions !== undefined) owned.add('category')
  if (changes.severity !== undefined) owned.add('severity')
  const s = o.suggestion
  const clears = (field: 'category' | 'severity') =>
    owned.has(field) && !!s && (!!s[field] || s.status === 'reading')
  for (const field of ['category', 'severity'] as const)
    if (clears(field)) set[`suggestion.${field}`] = null
  // A value sent for a field whose entry is cleared is written even when it
  // matches what was read (null included), in that same update: without this,
  // a run landing between the read and the write would leave the AI's value
  // stored as the engineer's (AC9).
  if (
    changes.copeDimensions !== undefined &&
    (clears('category') ||
      String(changes.copeDimensions) !== String(copeDimensionsOf(o.metadata.COPE_dimension)))
  )
    set['metadata.COPE_dimension'] = changes.copeDimensions
  if (
    changes.severity !== undefined &&
    (clears('severity') || changes.severity !== (o.severity ?? null))
  )
    set.severity = changes.severity
  if (changes.locationId && !o.location?.equals(changes.locationId))
    set.location = changes.locationId
  change('standard', o.standard, changes.standard)
  change('note', o.note, changes.note)
  if (changes.checklistItem === null) unset.checklistItem = 1
  else if (changes.checklistItem) {
    set.checklistItem = await checklistLink(o.assessment, changes.checklistItem, o._id)
  }
  if (changes.kinds === null) unset.kinds = 1
  else if (changes.kinds) set.kinds = changes.kinds
  if (changes.labels !== undefined) {
    if (changes.labels === null || !changes.labels.length) unset.labels = 1
    else set.labels = changes.labels
  }
  if (changes.asked !== undefined) {
    if (changes.asked) set.asked = stamp(user)
    else unset.asked = 1
  }
  // A failed suggestion with nothing left to suggest is over: both fields filled and the engineer's.
  const filled = (field: 'category' | 'severity', value: unknown, now: unknown) =>
    !!(value === undefined ? now : value) && (owned.has(field) || !s?.[field])
  if (
    s?.status === 'failed' &&
    filled('category', changes.copeDimensions, copeDimensionsOf(o.metadata.COPE_dimension)) &&
    filled('severity', changes.severity, o.severity)
  ) {
    set['suggestion.status'] = 'done'
    unset['suggestion.error'] = 1
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return toDto(o, locations)

  // Removing the note matches only while a recording, photo or page stays, so
  // a removal at the same moment can't leave nothing captured.
  const onlyAsked = [...Object.keys(set), ...Object.keys(unset)].every((k) => k === 'asked')
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      ...(unset.note && { $or: [KEEPS_RECORDING, KEEPS_PHOTO, KEEPS_PAGE] }),
    },
    {
      // Ticking an info request asked is not an edit of the observation.
      $set: { ...set, ...(!onlyAsked && { edited: stamp(user) }) },
      ...(Object.keys(unset).length && { $unset: unset }),
    },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  // Deleted, or left with only its note, between the read and the write.
  if (!updated) {
    if (await ObservationModel.exists({ _id: id, deleted: { $exists: true } }))
      throw new ObservationStateError(DELETED)
    throw new EmptyObservationError()
  }
  // The note is the main text the rating reads: a new one suggests again (CP-24).
  if ('note' in set || unset.note)
    return toDto((await queueReading(id, { rate: true })) ?? updated, locations)
  return toDto(updated, locations)
}

// Adds recordings, photos and handwritten pages to a saved observation (CP-08,
// CP-20), each stored in S3 as raw evidence and marked with who added it. Each
// recording and page starts its transcription, and the reading job is queued
// (CP-24). No capture session is needed: like the other changes, it is a
// correction its assigned engineer can make later.
export async function addMedia(
  id: string,
  recordings: NewRecording[],
  photos: NewPhoto[],
  user: SessionUser,
  pages: NewPage[] = [],
): Promise<ObservationDto> {
  const { observation: o, locations, reference } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  const added = stamp(user)
  const media = storedMedia(reference, o._id, { recordings, photos, pages }, added.at, added)
  const updated = await withUploads(media.files, async () => {
    const saved = await ObservationModel.findOneAndUpdate(
      { _id: id, deleted: { $exists: false } },
      {
        $push: {
          recordings: { $each: media.recordings },
          photos: { $each: media.photos },
          pages: { $each: media.pages },
        },
        $set: { edited: added },
      },
      { returnDocument: 'after' },
    ).lean<StoredObservation>()
    // Deleted between the read and the write.
    if (!saved) throw new ObservationStateError(DELETED)
    return saved
  })
  for (const r of media.recordings) queueTranscription(id, String(r._id))
  for (const p of media.pages) void runPageTranscription(id, String(p._id))
  // New media: describe the photos and suggest again (CP-24).
  return toDto((await queueReading(id, { rate: true })) ?? updated, locations)
}

export const MEDIA_KINDS = ['recordings', 'photos', 'pages'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]
const NOUN = { recordings: 'recording', photos: 'photo', pages: 'page' } as const

// Removes a recording, photo or handwritten page from an observation (CP-08,
// CP-20), a soft removal: it is marked with who removed it and when, its file
// stays in S3, and it is no longer evidence, so drafting, the photo collection
// and the Scans view leave it out. Something must stay captured; matching on
// that in the update makes it atomic, so two removals at once can't leave
// nothing.
export function removeMedia(id: string, kind: MediaKind, itemId: string, user: SessionUser) {
  return setRemoved(id, kind, itemId, user, true)
}
// Restores a removed recording, photo or page, back into evidence (CP-08, CP-20).
export function restoreMedia(id: string, kind: MediaKind, itemId: string, user: SessionUser) {
  return setRemoved(id, kind, itemId, user, false)
}

async function setRemoved(
  id: string,
  kind: MediaKind,
  itemId: string,
  user: SessionUser,
  remove: boolean,
): Promise<ObservationDto> {
  const { observation, locations } = await changeable(id, user)
  const noun = NOUN[kind]
  if (!isValidObjectId(itemId)) throw new ObservationNotFoundError(noun)
  const item = new Types.ObjectId(itemId)
  // A draft observation's recording goes for good, file and all (CP-24).
  if (observation.draft) {
    if (!remove || kind !== 'recordings') throw new ObservationNotFoundError(noun)
    return removeDraftRecording(observation, item, locations)
  }
  // Why the change can't be made to the observation as it stands, if it can't.
  const refusal = (o: StoredObservation) => {
    if (o.deleted) return new ObservationStateError(DELETED)
    const items: { _id: Types.ObjectId; removed?: IStamp }[] = o[kind] ?? []
    const found = items.find((i) => i._id.equals(item))
    if (!found) return new ObservationNotFoundError(noun)
    if (remove && found.removed)
      return new ObservationStateError(`This ${noun} is already removed.`)
    if (!remove && !found.removed) return new ObservationStateError(`This ${noun} is not removed.`)
    const others = (items: { _id: Types.ObjectId; removed?: IStamp }[]) =>
      kept(items).some((i) => !i._id.equals(item))
    if (
      remove &&
      !o.note &&
      !others(o.recordings) &&
      !others(o.photos ?? []) &&
      !others(o.pages ?? [])
    )
      return new EmptyObservationError(noun)
    return null
  }
  const problem = refusal(observation)
  if (problem) throw problem

  const now = stamp(user)
  const path = `${kind}.$[item].removed`
  const filter: Record<string, unknown> = {
    _id: id,
    deleted: { $exists: false },
    [kind]: { $elemMatch: { _id: item, removed: { $exists: !remove } } },
  }
  // Something else stays captured: a note, or another recording, photo or page.
  if (remove)
    filter.$or = [
      { note: { $type: 'string', $ne: '' } },
      ...MEDIA_KINDS.map((k) => ({
        [k]: {
          $elemMatch: { removed: { $exists: false }, ...(k === kind && { _id: { $ne: item } }) },
        },
      })),
    ]
  const updated = await ObservationModel.findOneAndUpdate(
    filter,
    remove
      ? { $set: { [path]: now, edited: now } }
      : { $set: { edited: now }, $unset: { [path]: 1 } },
    { arrayFilters: [{ 'item._id': item }], returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) {
    // It changed between the read and the write: say how, from how it is now.
    const current = await ObservationModel.findById(id).lean<StoredObservation>()
    throw (
      (current && refusal(current)) ??
      new ObservationStateError('This observation changed while saving. Try again.')
    )
  }
  // Its evidence changed: describe and suggest again (CP-24).
  return toDto((await queueReading(id, { rate: true })) ?? updated, locations)
}

// Deletes a draft observation's recording and its file (CP-24): a draft keeps
// nothing the engineer threw away. The file goes first and the record only
// once it has: without this order, a storage error would leave audio that
// nothing points at, never deleted.
async function removeDraftRecording(
  draft: StoredObservation,
  recordingId: Types.ObjectId,
  locations: ILocation[],
): Promise<ObservationDto> {
  const recording = draft.recordings.find((r) => r._id.equals(recordingId))
  if (!recording) throw new ObservationNotFoundError('recording')
  if (!(await deleteFiles([recording.key])))
    throw new ObservationStateError('This recording could not be deleted. Try again.')
  const updated = await ObservationModel.findOneAndUpdate(
    { _id: draft._id, draft: true },
    { $pull: { recordings: { _id: recordingId } } },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) throw new ObservationNotFoundError('draft observation')
  return toDto(updated, locations)
}

// Deletes files from S3, logging any that fail; returns whether every one went,
// so the caller keeps the record of any left (and can try again).
async function deleteFiles(keys: string[]): Promise<boolean> {
  const results = await Promise.all(
    keys.map((key) =>
      storage.deleteObject(key).then(
        () => true,
        (error: unknown) => {
          console.error(`Deleting ${key} failed:`, error)
          return false
        },
      ),
    ),
  )
  return results.every(Boolean)
}

// Marks the area of a photo that matters (CP-10), or clears the mark with null.
// Only the observation changes: the photo in S3 stays as taken (AC4), and the
// mark is drawn over it where it is shown. A removed photo is not evidence, so
// it can't be marked; matching on that in the update makes it atomic.
export async function markPhoto(
  id: string,
  photoId: string,
  region: IPhotoRegion | null,
  user: SessionUser,
): Promise<ObservationDto> {
  const { observation, locations } = await changeable(id, user)
  if (!isValidObjectId(photoId)) throw new ObservationNotFoundError('photo')
  const photo = new Types.ObjectId(photoId)
  const refusal = (o: StoredObservation) => {
    if (o.deleted) return new ObservationStateError(DELETED)
    const found = (o.photos ?? []).find((p) => p._id.equals(photo))
    if (!found) return new ObservationNotFoundError('photo')
    if (found.removed) return new ObservationStateError('This photo is removed.')
    return null
  }
  const problem = refusal(observation)
  if (problem) throw problem

  const now = stamp(user)
  const path = 'photos.$[photo].region'
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      photos: { $elemMatch: { _id: photo, removed: { $exists: false } } },
    },
    region
      ? { $set: { [path]: region, edited: now } }
      : { $set: { edited: now }, $unset: { [path]: 1 } },
    { arrayFilters: [{ 'photo._id': photo }], returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) {
    const current = await ObservationModel.findById(id).lean<StoredObservation>()
    throw (
      (current && refusal(current)) ??
      new ObservationStateError('This observation changed while saving. Try again.')
    )
  }
  // The model saw other marks: describe and suggest again (CP-24).
  return toDto((await queueReading(id, { rate: true })) ?? updated, locations)
}

// Corrects a finished transcript of a recording (CP-08 AC10) or a handwritten
// page (CP-20). What Whisper or the handwriting model wrote stays as it is, as
// evidence of what was said or read; drafting uses the correction. Writing the
// original back removes the correction. Matching on the transcribed status
// makes it atomic, so one still transcribing is never corrected.
export async function correctTranscript(
  id: string,
  itemId: string,
  text: string,
  user: SessionUser,
  kind: 'recordings' | 'pages' = 'recordings',
): Promise<ObservationDto> {
  const { observation: o, locations } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  const noun = NOUN[kind]
  const items: (IRecording | IPage)[] = o[kind] ?? []
  const item = isValidObjectId(itemId) ? items.find((i) => i._id.equals(itemId)) : undefined
  if (!item) throw new ObservationNotFoundError(noun)
  if (item.removed)
    throw new ObservationStateError(
      `This ${noun} is removed. Restore it before correcting its ${kind === 'pages' ? 'text' : 'transcript'}.`,
    )
  const { status, transcript, correction } = item.transcription
  if (status !== 'transcribed')
    throw new ObservationStateError('Only a finished transcription can be corrected.')
  if (text === (correction?.text ?? transcript)) return toDto(o, locations)

  const now = stamp(user)
  const path = `${kind}.$.transcription.correction`
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      [kind]: {
        $elemMatch: {
          _id: itemId,
          'transcription.status': 'transcribed',
          removed: { $exists: false },
        },
      },
    },
    text === transcript
      ? { $set: { edited: now }, $unset: { [path]: 1 } }
      : { $set: { edited: now, [path]: { text, ...now } } },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) {
    // Deleted, removed or being transcribed again between the read and the write.
    if (await ObservationModel.exists({ _id: id, deleted: { $exists: true } }))
      throw new ObservationStateError(DELETED)
    throw new ObservationStateError(`This ${noun} changed while saving. Try again.`)
  }
  // A corrected transcript or page: suggest again from it (CP-24).
  return toDto((await queueReading(id, { rate: true })) ?? updated, locations)
}

/** Returns the observation's assessment reference as a one-item list, or [] (AS-06's re-check). */
export async function assessmentReferencesOfObservation(id: string): Promise<string[]> {
  if (!isValidObjectId(id)) return []
  const observation = await ObservationModel.findById(id, 'assessment').lean()
  const assessment =
    observation && (await AssessmentModel.findById(observation.assessment, 'reference').lean())
  return assessment ? [assessment.reference] : []
}

// Deletes an observation (CP-08 AC12), a soft delete: it is marked with who
// deleted it and when, and nothing it holds is removed, its recordings in S3
// included. Lists and drafting leave it out from then on. Matching on
// `deleted` makes it atomic, so a double click cannot delete it twice.
export async function deleteObservation(id: string, user: SessionUser): Promise<ObservationDto> {
  const { locations } = await changeable(id, user)
  const updated = await ObservationModel.findOneAndUpdate(
    { _id: id, deleted: { $exists: false } },
    { $set: { deleted: stamp(user) } },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) throw new ObservationStateError('This observation is already deleted.')
  return toDto(updated, locations)
}

// Restores a deleted observation (CP-08 AC14), back into lists and drafting.
// Its location is still there: a location can't be removed while any
// observation, deleted ones included, is saved there.
export async function restoreObservation(id: string, user: SessionUser): Promise<ObservationDto> {
  const { locations } = await changeable(id, user)
  const updated = await ObservationModel.findOneAndUpdate(
    { _id: id, deleted: { $exists: true } },
    { $unset: { deleted: 1 } },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) throw new ObservationStateError('This observation is not deleted.')
  // A reading skipped while it was deleted runs now (CP-24): without this, it
  // could stay empty with no way to ask again.
  return toDto((await queueReading(id)) ?? updated, locations)
}

// Every observation of the assessment, newest first. Deleted ones are left
// out (CP-08 AC13), so the list, section evidence counts and drafting never
// read them, unless asked for. Draft observations (CP-24) are never listed:
// this is what every list, count, drafting input, Ask, the appendix and
// MarshBot read, so leaving them out here leaves them out everywhere.
export async function listObservations(
  reference: string,
  { includeDeleted = false } = {},
): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({
    assessment: assessment._id,
    draft: { $ne: true },
    ...(!includeDeleted && { deleted: { $exists: false } }),
  })
    .sort({ createdAt: -1 })
    .lean<StoredObservation[]>()
  return observations.map((o) => toDto(o, assessment.locations ?? []))
}

export type ToAskItem = {
  observationId: string
  text: string
  location: string | null
  severity: string
  // True once the engineer ticked it as asked.
  asked: boolean
}

// What to ask, in the engineer's words: the note, else a transcription, else the photo description.
function askText(o: ObservationDto): string {
  const spoken = [...o.recordings, ...o.pages].map(
    (m) => m.transcription.correction?.text ?? m.transcription.transcript,
  )
  return (
    [o.note, ...spoken, o.interpretation?.photos?.description].find((t) => t?.trim())?.trim() ?? ''
  )
}

/**
 * Returns the observations tagged Information request (CP-36), oldest first, each with its text
 * (note, else transcription or description), where it was seen and how serious: what to ask the
 * client. Read only. Throws AssessmentNotFoundError.
 */
export async function toAskFor(reference: string): Promise<ToAskItem[]> {
  const observations = (await listObservations(reference)).reverse()
  return observations
    .filter((o) => o.kinds?.includes('info_request'))
    .map((o) => ({
      observationId: o.id,
      text: askText(o),
      location: o.location ? locationText(o.location) : null,
      // Empty while the severity is still to be suggested or chosen (CP-24).
      severity: o.severity ?? '',
      asked: o.asked,
    }))
}

// The observations not deleted of several assessments at once, by assessment
// id, newest first in each: what a client's insights count across its sites
// (CP-29). One query, where listObservations would take one per assessment.
export async function listObservationsOf(
  assessments: { _id: Types.ObjectId; locations?: ILocation[] }[],
): Promise<Map<string, ObservationDto[]>> {
  const byAssessment = new Map<string, ObservationDto[]>(
    assessments.map((a) => [String(a._id), []]),
  )
  if (!assessments.length) return byAssessment
  const locations = new Map(assessments.map((a) => [String(a._id), a.locations ?? []]))
  const observations = await ObservationModel.find({
    assessment: { $in: assessments.map((a) => a._id) },
    // Never a draft observation (CP-24), as in listObservations.
    draft: { $ne: true },
    deleted: { $exists: false },
  })
    .sort({ createdAt: -1 })
    .lean<StoredObservation[]>()
  for (const o of observations) {
    const key = String(o.assessment)
    byAssessment.get(key)?.push(toDto(o, locations.get(key) ?? []))
  }
  return byAssessment
}

// The drafting inputs for one COPE category, oldest first, for section
// generation (GN-01). An observation not categorised yet has a null
// COPE_dimension, so it is left out until it is categorised (CP-02 AC4), and
// so is a deleted one (CP-08 AC13).
// When each observation was captured, by its ID, for a report's references
// to them (EX-01 AC6). A deleted one still has its time.
export async function captureTimes(ids: readonly string[]): Promise<Map<string, Date>> {
  const valid = [...new Set(ids)].filter((id) => isValidObjectId(id))
  if (!valid.length) return new Map()
  const found = await ObservationModel.find({ _id: { $in: valid } }, 'createdAt').lean()
  return new Map(found.map((o) => [String(o._id), o.createdAt]))
}

export async function listCategoryObservations(
  reference: string,
  copeDimension: CopeDimension,
): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({
    assessment: assessment._id,
    'metadata.COPE_dimension': copeDimension,
    // Never a draft observation (CP-24), as in listObservations.
    draft: { $ne: true },
    deleted: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .lean<StoredObservation[]>()
  return observations.map((o) => toDto(o, assessment.locations ?? []))
}

// Starts a new attempt for the same recording (CP-03 AC7). Matching on the
// failed status makes it atomic, so a double click cannot start two attempts.
// A removed recording (CP-08) is not retried until it is restored.
// shortcut: on a site walk observation this does not switch rating back on (only the engineer's own
// changes do, CP-24 AC17); add it to the reading's triggers if engineers expect a new suggestion here.
export async function retryTranscription(
  id: string,
  recordingId: string,
  user: SessionUser,
): Promise<void> {
  if (!isValidObjectId(id) || !isValidObjectId(recordingId)) throw new ObservationNotFoundError()
  await mustBeAssigned(id, user)
  const { matchedCount } = await ObservationModel.updateOne(
    {
      _id: id,
      recordings: {
        $elemMatch: {
          _id: recordingId,
          'transcription.status': 'failed',
          removed: { $exists: false },
        },
      },
    },
    {
      $set: { 'recordings.$.transcription.status': 'transcribing' },
      $unset: { 'recordings.$.transcription.error': 1 },
      $push: { 'recordings.$.transcription.attempts': { startedAt: new Date() } },
    },
  )
  if (!matchedCount) {
    const found = await ObservationModel.findOne(
      { _id: id, 'recordings._id': recordingId },
      { 'recordings.$': 1 },
    ).lean<StoredObservation>()
    if (found?.recordings[0]?.removed)
      throw new NotRetryableError('This recording is removed. Restore it before retrying it.')
    if (found) throw new NotRetryableError()
    throw new ObservationNotFoundError('recording')
  }
  queueTranscription(id, recordingId, true)
}

// Puts a voice note's transcription on the queue (CP-22). The job id is the
// recording's, so queueing it twice (a restart resuming it) runs it once; a
// retry gets a fresh one (see retryJobId). If Redis is down the recording is marked failed so the engineer can press Retry;
// without this it would stay Transcribing with no job until the next restart.
// Callers don't wait for it, so it never throws.
async function queueTranscription(observationId: string, recordingId: string, retry = false) {
  try {
    const jobId = `vn-${observationId}-${recordingId}`
    await transcriptionQueue.add(retry ? retryJobId(jobId) : jobId, {
      kind: 'voice-note',
      observationId,
      recordingId,
    })
  } catch (error) {
    console.error('Queueing transcription failed:', error)
    const reason = 'The recording could not be queued for transcription.'
    await ObservationModel.updateOne(
      { _id: observationId, 'recordings._id': recordingId },
      {
        $set: {
          'recordings.$.transcription.status': 'failed',
          'recordings.$.transcription.error': reason,
        },
      },
    ).catch((saveError) => console.error('Saving transcription failed:', saveError))
  }
}

onTranscriptionJob('voice-note', (job, context) =>
  runTranscription(job.observationId, job.recordingId, context),
)

// Runs the recording's latest attempt and records its outcome. A busy,
// rate-limited or timed-out speech service throws instead, so the queue retries
// it; without this the recording would be marked failed at the first "busy".
// On the last attempt, or for any other failure, the reason is stored for the
// engineer to see (CP-03 AC6). Updates only this recording, so the
// observation's other recordings can finish alongside. A database read or
// write that fails throws too, so the queue retries; without this the job
// would count as done and the recording would stay Transcribing.
export async function runTranscription(
  id: string,
  recordingId: string,
  context: JobContext = { isLastAttempt: true },
): Promise<void> {
  const observation = await ObservationModel.findOne(
    { _id: id, 'recordings._id': recordingId },
    { 'recordings.$': 1, assessment: 1 },
  ).lean<StoredObservation>()
  const recording = observation?.recordings[0]
  if (!recording) return
  // Already done (a job re-queued after a restart), so don't transcribe twice.
  if (recording.transcription.status !== 'transcribing') return
  // The assessment reference tags the Whisper usage record (EV-03).
  const reportId = (
    await AssessmentModel.findById(observation!.assessment, { reference: 1 })
      .lean()
      .catch(() => null)
  )?.reference
  const attempt = `recordings.$.transcription.attempts.${recording.transcription.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    const { transcript, spoken } = await transcribe(recording.key, reportId)
    outcome = {
      'recordings.$.transcription.transcript': transcript,
      'recordings.$.transcription.spoken': spoken,
      'recordings.$.transcription.status': 'transcribed',
    }
  } catch (error) {
    if (error instanceof SpeechServiceError && error.retryable && !context.isLastAttempt)
      throw error
    const reason = error instanceof Error ? error.message : 'Transcription failed.'
    outcome = {
      'recordings.$.transcription.status': 'failed',
      'recordings.$.transcription.error': reason,
      [`${attempt}.error`]: reason,
    }
  }
  await ObservationModel.updateOne(
    { _id: id, 'recordings._id': recordingId },
    { $set: { ...outcome, [`${attempt}.finishedAt`]: new Date() } },
  )
  await transcriptFinished(id, reportId)
}

// After a recording or page transcribed or failed: the reading job runs again
// (CP-24; it waited for this, and does nothing on a draft), the open page hears
// of it (drafts included, so New Observation shows the text), and MarshBot
// (AS-06) ticks off or raises the item.
async function transcriptFinished(id: string, reportId: string | undefined) {
  await queueReading(id)
  if (!reportId) return
  publishObservations(reportId)
  queueAssessmentCheck(reportId)
}

// Starts a new attempt for the same handwritten page (CP-19 AC11), as for a
// recording: matching on the failed status makes it atomic, so a double click
// cannot start two attempts.
export async function retryPageTranscription(
  id: string,
  pageId: string,
  user: SessionUser,
): Promise<void> {
  if (!isValidObjectId(id) || !isValidObjectId(pageId)) throw new ObservationNotFoundError()
  await mustBeAssigned(id, user)
  const { matchedCount } = await ObservationModel.updateOne(
    {
      _id: id,
      pages: {
        $elemMatch: { _id: pageId, 'transcription.status': 'failed', removed: { $exists: false } },
      },
    },
    {
      $set: { 'pages.$.transcription.status': 'transcribing' },
      $unset: { 'pages.$.transcription.error': 1 },
      $push: { 'pages.$.transcription.attempts': { startedAt: new Date() } },
    },
  )
  if (!matchedCount) {
    const found = await ObservationModel.findOne(
      { _id: id, 'pages._id': pageId },
      { 'pages.$': 1 },
    ).lean<StoredObservation>()
    // A removed page (CP-20) is not retried until it is restored.
    if (found?.pages?.[0]?.removed)
      throw new NotRetryableError('This page is removed. Restore it before retrying it.')
    if (found) throw new NotRetryableError()
    throw new ObservationNotFoundError('page')
  }
  void runPageTranscription(id, pageId)
}

// Transcribes a page again although its last transcription succeeded (CP-20), when
// the engineer thinks it misread the page. Unlike a retry after a failure, it
// replaces evidence drafts may have used, so, like the other changes to an
// observation (CP-08), only the assessment's assigned engineer can ask, and
// not once it is archived or the observation is deleted. The old text is
// cleared as the attempt starts, so the page reads as a new transcription;
// a draft that used it keeps its own copy and shows as out of date. The
// engineer's correction goes with it: asking for the page to be read again
// means wanting the model's reading, and the browser asks before dropping it.
// A removed page is not read until it is restored. Matching on the
// transcribed status makes it atomic, so a double click starts one.
export async function retranscribePage(
  id: string,
  pageId: string,
  user: SessionUser,
): Promise<ObservationDto> {
  const { observation: o, locations } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  const page = isValidObjectId(pageId)
    ? (o.pages ?? []).find((p) => p._id.equals(pageId))
    : undefined
  if (!page) throw new ObservationNotFoundError('page')
  if (page.removed)
    throw new ObservationStateError(
      'This page is removed. Restore it before transcribing it again.',
    )
  if (page.transcription.status === 'failed')
    throw new ObservationStateError('This page’s transcription failed. Retry it instead.')
  if (page.transcription.status === 'transcribing')
    throw new ObservationStateError('This page is already being transcribed.')

  const now = stamp(user)
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      pages: {
        $elemMatch: {
          _id: pageId,
          'transcription.status': 'transcribed',
          removed: { $exists: false },
        },
      },
    },
    {
      $set: { 'pages.$.transcription.status': 'transcribing', edited: now },
      $unset: {
        'pages.$.transcription.transcript': 1,
        'pages.$.transcription.uncertain': 1,
        'pages.$.transcription.provenance': 1,
        'pages.$.transcription.error': 1,
        'pages.$.transcription.correction': 1,
      },
      $push: { 'pages.$.transcription.attempts': { startedAt: now.at } },
    },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  // Deleted, or already being transcribed again, between the read and the write.
  if (!updated) throw new ObservationStateError('This page changed while saving. Try again.')
  void runPageTranscription(id, pageId)
  return toDto(updated, locations)
}

// Runs the page's latest attempt and records its outcome, as runTranscription
// does a recording's. Never throws: a failure is stored as the reason the
// engineer sees. Updates only this page, so the observation's other pages can
// finish alongside (CP-19 AC6).
export async function runPageTranscription(id: string, pageId: string): Promise<void> {
  const observation = await ObservationModel.findOne(
    { _id: id, 'pages._id': pageId },
    { 'pages.$': 1, assessment: 1 },
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const page = observation?.pages?.[0]
  if (!page) return
  // The assessment reference tags the usage record (EV-03).
  const reportId = (
    await AssessmentModel.findById(observation!.assessment, { reference: 1 })
      .lean()
      .catch(() => null)
  )?.reference
  const attempt = `pages.$.transcription.attempts.${page.transcription.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    const result = await transcribeHandwriting(page.key, reportId)
    outcome = {
      'pages.$.transcription.transcript': result.transcript,
      'pages.$.transcription.uncertain': result.uncertain,
      'pages.$.transcription.provenance': {
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
      },
      'pages.$.transcription.status': 'transcribed',
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Transcription failed.'
    outcome = {
      'pages.$.transcription.status': 'failed',
      'pages.$.transcription.error': reason,
      [`${attempt}.error`]: reason,
    }
  }
  await ObservationModel.updateOne(
    { _id: id, 'pages._id': pageId },
    { $set: { ...outcome, [`${attempt}.finishedAt`]: new Date() } },
  ).catch((error) => console.error('Saving page transcription failed:', error))
  await transcriptFinished(id, reportId)
}

// After a restart: a voice note still Transcribing goes back on the queue
// (CP-22; the job id makes this a no-op when Redis kept the job), while a
// handwritten page's attempt, which ran in memory, is marked failed so the
// engineer sees why and can retry, rather than waiting on Transcribing forever.
export async function resumeInterruptedTranscriptions() {
  const waiting = await ObservationModel.find(
    { 'recordings.transcription.status': 'transcribing' },
    { recordings: 1 },
  ).lean<StoredObservation[]>()
  for (const o of waiting)
    for (const r of o.recordings)
      if (r.transcription.status === 'transcribing')
        queueTranscription(String(o._id), String(r._id))
  const pagesWaiting = await ObservationModel.distinct('_id', {
    'pages.transcription.status': 'transcribing',
  })
  await ObservationModel.updateMany(
    { 'pages.transcription.status': 'transcribing' },
    {
      $set: {
        'pages.$[r].transcription.status': 'failed',
        'pages.$[r].transcription.error':
          'Transcription was interrupted by a gateway restart. Retry it.',
      },
    },
    { arrayFilters: [{ 'r.transcription.status': 'transcribing' }] },
  )
  // Their reading waited for these pages (CP-24); without this it would wait forever.
  await Promise.all(pagesWaiting.map((id) => queueReading(id as Types.ObjectId)))
}

// The recording's type, size and `open`, which streams all of it or a byte range.
export async function getRecordingAudio(id: string, recordingId: string) {
  if (!isValidObjectId(id) || !isValidObjectId(recordingId)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findOne(
    { _id: id, 'recordings._id': recordingId },
    { 'recordings.$': 1 },
  ).lean<StoredObservation>()
  const recording = observation?.recordings[0]
  if (!recording) throw new ObservationNotFoundError('recording')
  return {
    contentType: recording.contentType,
    size: recording.size,
    open: (range?: ByteRange) => storage.getObjectStream(recording.key, range),
  }
}

// The original photo from S3, the raw evidence (CP-04 AC1).
export async function getPhotoImage(id: string, photoId: string) {
  if (!isValidObjectId(id) || !isValidObjectId(photoId)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findOne(
    { _id: id, 'photos._id': photoId },
    { 'photos.$': 1 },
  ).lean<StoredObservation>()
  const photo = observation?.photos?.[0]
  if (!photo) throw new ObservationNotFoundError('photo')
  return {
    contentType: photo.contentType,
    size: photo.size,
    open: (range?: ByteRange) => storage.getObjectStream(photo.key, range),
  }
}

// A photo as the model last saw it with protection on: faces blurred (PV-04).
// Not found when it never went with a face blurred.
export async function getRedactedPhotoImage(id: string, photoId: string) {
  if (!isValidObjectId(id) || !isValidObjectId(photoId)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findOne(
    { _id: id, 'photos._id': photoId },
    { 'photos.$': 1 },
  ).lean<StoredObservation>()
  const redaction = observation?.photos?.[0]?.redaction
  if (!redaction?.key || !redaction.size) throw new ObservationNotFoundError('photo')
  return {
    size: redaction.size,
    stream: await storage.getObjectStream(redaction.key),
  }
}

// The original photo of a handwritten page from S3, the raw evidence (CP-19 AC1).
export async function getPageImage(id: string, pageId: string) {
  if (!isValidObjectId(id) || !isValidObjectId(pageId)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findOne(
    { _id: id, 'pages._id': pageId },
    { 'pages.$': 1 },
  ).lean<StoredObservation>()
  const page = observation?.pages?.[0]
  if (!page) throw new ObservationNotFoundError('page')
  return {
    contentType: page.contentType,
    size: page.size,
    stream: await storage.getObjectStream(page.key),
  }
}

// What createWalkObservation needs of the walk's recording and photos (CP-22).
export type WalkEvidence = {
  clip: {
    siteWalk: Types.ObjectId
    seq: number
    key: string
    contentType: string
    size: number
    start: number
    end: number
    text: string
  } | null
  photos: { photoId: string; key: string; contentType: 'image/jpeg' | 'image/png'; size: number }[]
  // Voice clips and handwritten pages added to the proposal by hand (round 3),
  // kept at the walk's own S3 keys. A clip's transcript is null when the walk
  // had none yet; it is transcribed here instead.
  voices?: { key: string; contentType: string; size: number; transcript: string | null }[]
  pages?: { key: string; contentType: 'image/jpeg' | 'image/png'; size: number }[]
}

// Saves one observation from a reviewed site walk (CP-22), under a chosen id so
// Create all can be repeated: if that id is saved already, nothing happens.
// Its one recording entry points at the walk recording's own S3 key with a clip
// (start, end) and the clip's text as a finished transcript, so drafting reads
// it as evidence and the page can play just that part. Its photos are copied
// into the observation's own folder, so deleting the walk keeps them.
export async function createWalkObservation(input: {
  reference: string
  id: Types.ObjectId
  assessmentId: Types.ObjectId
  sessionId: Types.ObjectId
  site: ISite | null
  user: SessionUser
  locationId: Types.ObjectId
  note: string
  severity: Severity
  copeDimensions: CopeDimension[] | null
  evidence: WalkEvidence
  siteWalk: Types.ObjectId
  // The proposal's not-sure flags (CP-24), carried onto the observation as its
  // suggestion marks; absent on proposals saved before the flags were shown.
  check?: { category: boolean; severity: boolean }
}): Promise<void> {
  // Same id from the same walk = already created. Not keyed on the session or
  // engineer: a retry after the session ended or a reassignment would 500 forever.
  const identity = { _id: input.id, assessment: input.assessmentId, siteWalk: input.siteWalk }
  if (await ObservationModel.exists(identity)) return
  const now = new Date()
  const { clip, voices = [], pages = [] } = input.evidence
  const voiceRecordings = voices.map((v, i) => ({
    _id: new Types.ObjectId(),
    name: `Recording ${i + 1}`,
    key: v.key,
    contentType: v.contentType,
    size: v.size,
    transcription:
      v.transcript === null
        ? { status: 'transcribing' as const, attempts: [{ startedAt: now }] }
        : {
            status: 'transcribed' as const,
            transcript: v.transcript,
            attempts: [{ startedAt: now, finishedAt: now }],
          },
  }))
  const storedPages = pages.map((p, i) => ({
    _id: new Types.ObjectId(),
    name: `Page ${i + 1}`,
    ...p,
    transcription: { status: 'transcribing' as const, attempts: [{ startedAt: now }] },
  }))
  let created = true
  const photos = await Promise.all(
    input.evidence.photos.map(async (p, i) => {
      const photoId = new Types.ObjectId()
      const extension = p.contentType === 'image/png' ? 'png' : 'jpg'
      const chunks: Buffer[] = []
      for await (const chunk of await storage.getObjectStream(p.key))
        chunks.push(Buffer.from(chunk))
      return {
        stored: {
          _id: photoId,
          name: `Photo ${i + 1}`,
          key: `photos/${input.reference}/${input.id}/${photoId}.${extension}`,
          contentType: p.contentType,
          size: p.size,
        },
        body: Buffer.concat(chunks),
      }
    }),
  )
  await withUploads(
    photos.map((p) => ({ key: p.stored.key, body: p.body, type: p.stored.contentType })),
    () =>
      ObservationModel.create({
        _id: input.id,
        assessment: input.assessmentId,
        session: input.sessionId,
        engineer: input.user.name,
        engineerId: input.user.id,
        // A blank note counts as none, as in saveObservation.
        note: input.note.trim() ? input.note : undefined,
        recordings: [
          ...(clip
            ? [
                {
                  name: `Site walk, recording ${clip.seq}`,
                  key: clip.key,
                  contentType: clip.contentType,
                  size: clip.size,
                  clip: { siteWalk: clip.siteWalk, start: clip.start, end: clip.end },
                  transcription: {
                    status: 'transcribed' as const,
                    transcript: clip.text,
                    attempts: [{ startedAt: now, finishedAt: now }],
                  },
                },
              ]
            : []),
          ...voiceRecordings,
        ],
        photos: photos.map((p) => p.stored),
        pages: storedPages,
        severity: input.severity,
        location: input.locationId,
        siteWalk: input.siteWalk,
        // Each value the walk was not sure of starts marked, until the engineer
        // confirms or changes it (CP-24).
        ...((input.check?.category || input.check?.severity) && {
          suggestion: {
            status: 'done',
            category: input.check.category ? { notSure: true } : null,
            severity: input.check.severity ? { notSure: true } : null,
          },
        }),
        metadata: {
          source_type: 'observation',
          jurisdiction: input.site?.jurisdiction ?? 'unknown',
          facility_type: input.site?.facilityType ?? 'unknown',
          COPE_dimension: input.copeDimensions,
          effective_date: now,
        },
      }),
  ).catch(async (error: unknown) => {
    // A simultaneous Create all may win the insert. Its identity must match, and
    // withUploads must remove this attempt's unused photos before accepting it.
    if (duplicateKeyField(error) !== '_id' || !(await ObservationModel.exists(identity)))
      throw error
    created = false
  })
  // Only the call that made it starts the transcriptions, so a repeat runs none twice.
  if (!created) return
  // Its photos are described, but rating stays off until the engineer first
  // changes it, so the proposal's values and marks carry over (AC5, AC17).
  // Before the transcriptions, so none can finish and rate before it is off.
  await queueReading(input.id, { rate: false })
  for (const r of voiceRecordings)
    if (r.transcription.status === 'transcribing')
      queueTranscription(String(input.id), String(r._id))
  for (const p of storedPages) void runPageTranscription(String(input.id), String(p._id))
}

// Tries again after a failed suggestion (CP-24 AC13) or a failed photo
// description (the job describes them again): a new run, Reading at once. For
// whoever may change the observation, as for PATCH.
export async function retrySuggestion(id: string, user: SessionUser): Promise<ObservationDto> {
  const { observation: o, locations } = await changeable(id, user)
  if (o.draft) throw new ObservationNotFoundError()
  if (o.deleted) throw new ObservationStateError(DELETED)
  if (o.suggestion?.status !== 'failed' && photoReadingOf(o)?.status !== 'failed')
    throw new ObservationStateError(
      'Only a failed suggestion or photo description can be tried again.',
    )
  return toDto((await queueReading(id, { rate: true })) ?? o, locations)
}

/**
 * Returns one observation (CP-24: the open page re-reads it on each push). A
 * draft observation only to whoever may edit its assessment; a saved one to
 * anyone who can open the assessment.
 */
export async function getObservation(id: string, user: SessionUser): Promise<ObservationDto> {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const o = await ObservationModel.findById(id).lean<StoredObservation>()
  if (!o) throw new ObservationNotFoundError()
  if (o.draft) return toDto(o, (await changeable(id, user)).locations)
  const assessment = await AssessmentModel.findById(o.assessment, 'engineer locations').lean()
  if (!assessment) throw new ObservationNotFoundError()
  if (!opensAssessment(user, assessment.engineer))
    throw new NotAssignedError('Only the assigned engineer or an admin can open this.')
  return toDto(o, assessment.locations ?? [])
}

// Adds recordings made on New Observation before Save (CP-24 AC1), each
// stored in S3 and transcribed as a saved one is. The first creates the draft
// observation that holds them: hidden from every list, with no location, until
// Save turns it into the observation. Only the assessment's assigned engineer,
// in its active capture session, as for saving.
export async function addDraftRecordings(
  reference: string,
  recordings: NewRecording[],
  user: SessionUser,
  draftId?: string,
): Promise<ObservationDto> {
  const { assessment, session } = await activeCapture(reference, user)
  if (draftId !== undefined && !isValidObjectId(draftId))
    throw new ObservationNotFoundError('draft observation')
  const id = draftId ? new Types.ObjectId(draftId) : new Types.ObjectId()
  const media = storedMedia(reference, id, { recordings, photos: [] }, new Date())
  const saved = await withUploads(media.files, async () => {
    if (!draftId)
      return (
        await ObservationModel.create({
          _id: id,
          assessment: assessment._id,
          session: session._id,
          engineer: user.name,
          engineerId: user.id,
          draft: true,
          recordings: media.recordings,
          metadata: {
            source_type: 'observation',
            jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
            facility_type: assessment.site?.facilityType ?? 'unknown',
            COPE_dimension: null,
            effective_date: new Date(),
          },
        })
      ).toObject<StoredObservation>()
    const found = await ObservationModel.findOneAndUpdate(
      { _id: id, assessment: assessment._id, draft: true },
      { $push: { recordings: { $each: media.recordings } } },
      { returnDocument: 'after' },
    ).lean<StoredObservation>()
    // Saved or discarded meanwhile.
    if (!found) throw new ObservationNotFoundError('draft observation')
    return found
  })
  for (const r of media.recordings) queueTranscription(String(id), String(r._id))
  return toDto(saved, assessment.locations ?? [])
}

// Deletes a draft observation and its recordings' files (CP-24 AC3), when the
// engineer leaves New Observation without saving. Not found unless it is one.
// A storage error still answers as done (the engineer has left): the draft
// stays, and the hourly cleanup tries again.
export async function discardDraft(id: string, user: SessionUser): Promise<void> {
  const { observation } = await changeable(id, user)
  if (!observation.draft) throw new ObservationNotFoundError('draft observation')
  await deleteDraft(observation)
}

// Deletes the files first and the record only once every one went: without
// this order, a storage error would orphan audio nothing points at. Matching on
// `draft` stops it deleting an observation saved a moment before. Returns
// whether the draft was deleted.
// shortcut: a Save landing between the two steps keeps a record whose audio is gone (a window of a
// few milliseconds); lock the draft while it is discarded if that ever shows up.
async function deleteDraft(draft: StoredObservation): Promise<boolean> {
  if (!(await deleteFiles(draft.recordings.map((r) => r.key)))) return false
  const { deletedCount } = await ObservationModel.deleteOne({ _id: draft._id, draft: true })
  return deletedCount > 0
}

/** Deletes draft observations unchanged for 24 hours before `now`, with their files; returns how many. */
export async function cleanupStaleDrafts(now: Date): Promise<number> {
  // By last change, not start: adding a recording keeps an open form's draft alive.
  const stale = await ObservationModel.find({
    draft: true,
    updatedAt: { $lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
  }).lean<StoredObservation[]>()
  let deleted = 0
  for (const draft of stale) if (await deleteDraft(draft)) deleted++
  return deleted
}

// The hourly cleanup of drafts left behind, e.g. by a closed tab (CP-24),
// run by BullMQ in this process (job-queue.service.ts).
const draftCleanupQueue = defineQueue<{ kind: 'cleanup' }>(
  'observation-draft-cleanup',
  { concurrency: 1, attempts: 3, backoffMs: 60_000 },
  async () => {
    const deleted = await cleanupStaleDrafts(new Date())
    if (deleted) console.log(`Deleted ${deleted} stale draft observation(s).`)
  },
)

/** Schedules the draft cleanup hourly; returns once Redis holds it. Called once the gateway boots. */
export const scheduleDraftCleanup = () =>
  draftCleanupQueue.schedule('observation-draft-cleanup-hourly', '0 * * * *', { kind: 'cleanup' })
