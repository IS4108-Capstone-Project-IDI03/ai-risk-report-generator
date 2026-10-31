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
  type IObservation,
  type IPage,
  type IPhoto,
  type IPhotoReading,
  type IReadItem,
  type IRecording,
  type IStamp,
  type CheckResult,
  type IChecklistLink,
  type ReadItemKind,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls, visionUsageToWire } from './ai-usage.service'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { locationText, toLocationDto, type LocationDto } from './location.service'
import { interpret, transcribe, transcribeHandwriting } from './speech.service'
import * as storage from './storage.service'

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
// Removing the note, a recording or a photo would leave the observation with
// nothing captured (CP-08).
export class EmptyObservationError extends Error {
  constructor(what: 'note' | 'recording' | 'photo' = 'note') {
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

  // Sent explicitly: null or [] leaves the observation uncategorised (CP-02 AC4).
  copeDimensions: copeDimensionsField,
  severity: severityField,
  locationId: locationIdField,
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
export const observationChangesSchema = z.object({
  copeDimensions: copeDimensionsField.optional(),
  severity: severityField.optional(),
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
export type NewRecording = { name: string; audio: Buffer; contentType: string }
// The route has already checked it is a JPG or PNG (photoFormat).
export type NewPhoto = { name: string; image: Buffer }
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
}
// Each links to its original image (CP-04 AC2).
type PhotoDto = {
  type: 'Photo'
  id: string
  name: string
  contentType: IPhoto['contentType']
  size: number
  url: string
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
  }
}

export type ObservationDto = {
  id: string
  engineer: string
  engineerId: string | null
  // Its categories in C-O-P-E order; null when not categorised yet.
  copeDimensions: CopeDimension[] | null
  standard: string | null
  severity: IObservation['severity']
  // null only if the location is no longer listed.
  location: LocationDto | null
  note: string | null
  // Its evidence: the recordings and photos not removed. Everything that
  // reads these, drafting included, leaves removed ones out (CP-08).
  recordings: RecordingDto[]
  photos: PhotoDto[]
  // Its handwritten pages (CP-19), in the order they were saved.
  pages: PageDto[]
  // Removed ones, with who removed them and when, to restore (CP-08).
  removedRecordings: (RecordingDto & { removed: StampDto })[]
  removedPhotos: (PhotoDto & { removed: StampDto })[]
  // What the model proposes from it (CP-05, CP-21), for the engineer to
  // review; null until an engineer asks for it to be read. Its two parts are
  // read together the first time and one at a time after: the categories
  // (these fields) and the photos' description (`photos`).
  interpretation: {
    // Where the categories stand.
    status: IInterpretation['status']
    // The photos' description and hazard type, with where they stand; null
    // until its photos are first described.
    photos: {
      status: IInterpretation['status']
      description: string | null
      hazardType: string | null
      error: string | null
      attempts: number
      model: string | null
      // The photos it describes, removed ones included.
      photoIds: string[]
      // Finished, but of photos other than those it has now.
      outOfDate: boolean
    } | null
    // The proposed categories, each with what it rests on. A reading from
    // before CP-21 proposed one, with no reason.
    categories: {
      category: CopeDimension
      reason: string | null
      evidence: {
        item: string
        quote: string | null
        // null for a photo, which has no words to check.
        verified: boolean | null
      }[]
    }[]
    error: string | null
    attempts: number
    // The model that wrote it.
    model: string | null
    // The photos it reads (CP-08), removed ones included.
    photoIds: string[]
    // Everything it reads, by the labels its evidence cites (CP-21); a
    // recording or page with no transcript is listed as left out.
    items: { label: string; kind: ReadItemKind; id: string | null; leftOut: boolean }[]
    // A finished reading of something other than what it has now: photos,
    // recordings or pages added or removed, a transcript changed, or the note
    // edited other than by taking in the proposal's description (CP-08, CP-21).
    outOfDate: boolean
  } | null
  // The checklist item it answers (CP-31), with the item's text then; null
  // when it was captured on its own.
  checklistItem: { itemId: string; result: CheckResult; text: string } | null
  // When it was captured (CP-02 AC2).
  recordedAt: Date
  // The latest change to its tags, note, a transcript, or its recordings and
  // photos (CP-08).
  edited: StampDto | null
  // Set while it is deleted (CP-08).
  deleted: StampDto | null
}

type StoredObservation = IObservation & { _id: Types.ObjectId }

// Keep diagnostic detail in the saved attempt, but return a readable reason
// to every observation view, including recordings saved before this change.
function transcriptionFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The recording could not be read from storage:')) {
    return /SSL|certificate/i.test(error)
      ? 'Could not securely connect to audio storage.'
      : 'The recording could not be read from storage.'
  }
  if (error.startsWith('Whisper could not transcribe the recording:'))
    return 'The speech service could not transcribe the recording.'
  return error.length > 200 ? 'Transcription failed. Please retry or contact support.' : error
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

// The same for reading an observation (CP-05, CP-21), from S5's message
// prefixes (microservices/speech-ocr-service/app/processors/vision.py).
function interpretationFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The photo could not be read from storage:'))
    return 'A photo could not be read from storage.'
  if (error.startsWith('The photo could not be opened:')) return 'A photo could not be opened.'
  if (
    error.startsWith('The observation could not be read:') ||
    // Stored by readings from before CP-21.
    error.startsWith('The photos could not be interpreted:')
  ) {
    // The provider's own status, when it says why, as for a handwritten page.
    if (/Error code: 429|rate limit|quota/i.test(error))
      return 'The AI service has reached its usage limit. Try again later.'
    if (/Error code: 503|high demand|overloaded/i.test(error))
      return 'The AI service is busy. Try again in a minute.'
    return 'The AI service could not read this observation.'
  }
  return error.length > 200 ? 'Interpretation failed. Please retry or contact support.' : error
}

// The recordings or photos not removed (CP-08): the observation's evidence.
const kept = <T extends { removed?: IStamp }>(items: T[]) => items.filter((item) => !item.removed)

// The photos a reading reads, by id: its own list, or for a reading from
// before photos could change, every photo the observation was saved with.
function readPhotoIds(o: StoredObservation): string[] {
  const ids =
    o.interpretation?.photoIds ?? (o.photos ?? []).filter((p) => !p.added).map((p) => p._id)
  return ids.map(String)
}

// A transcript a reading can use: the engineer's correction of a recording's
// where there is one (CP-08 AC5), and none while it is still transcribing,
// failed, or empty (a page with no handwriting).
function readableText(t: IRecording['transcription'] | IPage['transcription']): string | null {
  if (t.status !== 'transcribed') return null
  const text = ('correction' in t && t.correction?.text) || t.transcript
  return text?.trim() ? text : null
}

// Everything an observation holds for a reading to read (CP-21), each under
// the label its proposal will cite it by: the note, then its recordings, pages
// and photos not removed, by their own names, a repeated name numbered.
function readingItems(o: StoredObservation): IReadItem[] {
  const items: IReadItem[] = [
    ...(o.note?.trim() ? [{ label: 'Note', kind: 'note' as const, text: o.note }] : []),
    ...kept(o.recordings).map((r) => ({
      label: r.name,
      kind: 'recording' as const,
      id: r._id,
      text: readableText(r.transcription),
    })),
    ...(o.pages ?? []).map((p) => ({
      label: p.name,
      kind: 'page' as const,
      id: p._id,
      text: readableText(p.transcription),
    })),
    ...kept(o.photos ?? []).map((p) => ({ label: p.name, kind: 'photo' as const, id: p._id })),
  ]
  const seen = new Map<string, number>()
  return items.map((item) => {
    const count = (seen.get(item.label) ?? 0) + 1
    seen.set(item.label, count)
    return count === 1 ? item : { ...item, label: `${item.label} (${count})` }
  })
}

// Whether what an observation holds now differs from what a reading read
// (CP-21): any recording, page or photo added or removed, a transcript
// changed, or the note changed. Taking the proposal's description into the
// note, as Use as note writes it, is not a change: it came from the reading.
function itemsChanged(read: IReadItem[], now: IReadItem[], description?: string): boolean {
  const key = (item: IReadItem) => `${item.kind}:${item.id ?? ''}`
  const evidence = (items: IReadItem[]) => items.filter((item) => item.kind !== 'note')
  const before = new Map(evidence(read).map((item) => [key(item), item.text ?? null]))
  const after = evidence(now)
  if (
    after.length !== before.size ||
    after.some((item) => !before.has(key(item)) || before.get(key(item)) !== (item.text ?? null))
  )
    return true
  const noteOf = (items: IReadItem[]) => items.find((item) => item.kind === 'note')?.text ?? ''
  const noteBefore = noteOf(read)
  const noteNow = noteOf(now)
  if (noteNow === noteBefore) return false
  return !description || noteNow !== (noteBefore ? `${noteBefore}\n\n${description}` : description)
}

// The photos' part of a reading as it stands (CP-21): its own record, or on a
// reading from before the parts were split, the description kept with the
// categories, under their status.
function photoReadingOf(o: StoredObservation): IPhotoReading | null {
  const reading = o.interpretation
  if (!reading) return null
  if (reading.photoReading) return reading.photoReading
  if (reading.description === undefined && reading.hazardType === undefined) return null
  return {
    status: reading.status,
    description: reading.description,
    hazardType: reading.hazardType,
    attempts: reading.attempts,
    photoIds: readPhotoIds(o).map((id) => new Types.ObjectId(id)),
    provenance: reading.provenance,
  }
}

// A finished description of photos other than those kept now (CP-08): photos
// were added or removed since. Nothing else it reads changes it.
function photosOutOfDate(o: StoredObservation): boolean {
  const reading = photoReadingOf(o)
  if (reading?.status !== 'interpreted') return false
  const read = reading.photoIds.map(String)
  const now = kept(o.photos ?? []).map((p) => String(p._id))
  return read.length !== now.length || now.some((id) => !read.includes(id))
}

// Finished categories of something other than what the observation holds now.
// A reading from before CP-21 read only its photos and note: it is judged by
// its photos (CP-08), and is out of date once there is a transcript it never
// read, so the engineer can ask for one that reads it.
function readingOutOfDate(o: StoredObservation): boolean {
  if (o.interpretation?.status !== 'interpreted') return false
  const now = readingItems(o)
  if (o.interpretation.items)
    return itemsChanged(o.interpretation.items, now, photoReadingOf(o)?.description)
  const read = readPhotoIds(o)
  const photos = now.filter((item) => item.kind === 'photo').map((item) => String(item.id))
  return (
    read.length !== photos.length ||
    photos.some((id) => !read.includes(id)) ||
    now.some((item) => (item.kind === 'recording' || item.kind === 'page') && item.text)
  )
}

// Curly quotes and long dashes as typed on a phone, read as their plain forms.
const PLAIN: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }
const plain = (text: string) =>
  text
    .replace(/[‘’“”–—]/g, (c) => PLAIN[c])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
// Spaces and ASCII punctuation at a quote's edges, as Python's string.punctuation.
const EDGES = /^[\s!-/:-@[-`{-~]+|[\s!-/:-@[-`{-~]+$/g

// Whether a quote appears in an item's text (CP-21): case, spacing, curly
// quotes and punctuation at its edges aside. The category eval checks quotes
// the same way (speech-ocr-service/eval/suggest_categories.py).
export function quoteFound(quote: string | null | undefined, text: string): boolean {
  const words = plain(quote ?? '').replace(EDGES, '')
  return !!words && plain(text).includes(words)
}

function interpretationDto(
  o: StoredObservation,
  reading: IInterpretation,
): NonNullable<ObservationDto['interpretation']> {
  // A reading from before CP-21 read the note and photos, and proposed one
  // category with no reason.
  const items =
    reading.items ??
    (o.photos ?? [])
      .filter((p) => readPhotoIds(o).includes(String(p._id)))
      .map((p) => ({ label: p.name, kind: 'photo' as const, id: p._id }))
  const categories =
    reading.categories?.map((c) => ({
      category: c.category,
      reason: c.reason,
      evidence: c.evidence.map((e) => ({
        item: e.item,
        quote: e.quote ?? null,
        verified: e.verified ?? null,
      })),
    })) ??
    (reading.copeDimension ? [{ category: reading.copeDimension, reason: null, evidence: [] }] : [])
  const photos = photoReadingOf(o)
  return {
    status: reading.status,
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
    categories,
    error: interpretationFailureReason(reading.error),
    attempts: reading.attempts.length,
    model: reading.provenance?.model ?? null,
    photoIds: readPhotoIds(o),
    items: items.map((item) => ({
      label: item.label,
      kind: item.kind,
      id: item.id ? String(item.id) : null,
      leftOut: item.kind !== 'note' && item.kind !== 'photo' && !item.text,
    })),
    outOfDate: readingOutOfDate(o),
  }
}

function toDto(o: StoredObservation, locations: ILocation[]): ObservationDto {
  const location = locations.find((l) => l._id.equals(o.location))
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
  })
  const photo = (p: IPhoto): PhotoDto => ({
    type: 'Photo',
    id: String(p._id),
    name: p.name,
    contentType: p.contentType,
    size: p.size,
    url: `/api/observations/${o._id}/photos/${p._id}/image`,
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
    },
  })
  const photos = o.photos ?? []
  const keptPhotos = kept(photos)
  return {
    id: String(o._id),
    engineer: o.engineer,
    engineerId: o.engineerId ? String(o.engineerId) : null,
    copeDimensions: copeDimensionsOf(o.metadata.COPE_dimension),
    standard: o.standard ?? null,
    severity: o.severity,
    location: location ? toLocationDto(location) : null,
    note: o.note ?? null,
    recordings: kept(o.recordings).map(recording),
    photos: keptPhotos.map(photo),
    pages: (o.pages ?? []).map(page),
    removedRecordings: o.recordings
      .filter((r) => r.removed)
      .map((r) => ({ ...recording(r), removed: stampDto(r.removed)! })),
    removedPhotos: photos
      .filter((p) => p.removed)
      .map((p) => ({ ...photo(p), removed: stampDto(p.removed)! })),
    interpretation: o.interpretation ? interpretationDto(o, o.interpretation) : null,
    checklistItem: o.checklistItem
      ? {
          itemId: String(o.checklistItem.item),
          result: o.checklistItem.result,
          text: o.checklistItem.text,
        }
      : null,
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
// Nothing is read: nothing goes to the model until an engineer asks
// (readObservation). The session stays active, so the engineer can keep adding
// observations.
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
  const link = details.checklistItem && (await checklistLink(assessment._id, details.checklistItem))
  const id = new Types.ObjectId()
  const now = new Date()
  const media = storedMedia(reference, id, { recordings, photos, pages }, now)
  const observation = await withUploads(media.files, () =>
    ObservationModel.create({
      _id: id,
      assessment: assessment._id,
      session: session._id,
      engineer: user.name,
      engineerId: user.id,
      note: details.note,
      recordings: media.recordings,
      photos: media.photos,
      pages: media.pages,
      standard: details.standard,
      severity: details.severity,
      location: details.locationId,
      ...(link && { checklistItem: link }),
      metadata: {
        source_type: 'observation',
        jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
        facility_type: assessment.site?.facilityType ?? 'unknown',
        COPE_dimension: details.copeDimensions,
        effective_date: now,
      },
    }),
  )

  // The observation now checks the item, so a Not seen or Not applicable mark
  // on it no longer says anything.
  if (link) {
    await ChecklistModel.updateOne(
      { _id: link.checklist, 'items._id': link.item },
      { $set: { 'items.$.check': null } },
    )
  }

  for (const r of media.recordings) void runTranscription(String(id), String(r._id))
  for (const p of media.pages) void runPageTranscription(String(id), String(p._id))
  return toDto(observation.toObject(), locations)
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
  const checked = await ObservationModel.exists({
    assessment,
    'checklistItem.item': { $in: [item._id, ...(item.carried ?? [])] },
    deleted: { $exists: false },
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
// AC6). `added` marks recordings and photos added after the observation was
// saved (CP-08).
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

// Matches an observation keeping a recording, or a photo, not removed, or a
// handwritten page (CP-19).
const KEEPS_RECORDING = { recordings: { $elemMatch: { removed: { $exists: false } } } }
const KEEPS_PHOTO = { photos: { $elemMatch: { removed: { $exists: false } } } }
const KEEPS_PAGE = { 'pages.0': { $exists: true } }

// Changes an observation's tags (CP-06) and note (CP-08). The tags cover the
// note and every recording, so they are set once. Categorising an
// uncategorised observation brings it into drafting (CP-02 AC4). Only what
// differs is saved, with who changed it; a change to nothing records nothing.
// The value drafts cited stays in each draft's own `evidence` (CP-08 AC15).
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
    !o.pages?.length
  )
    throw new EmptyObservationError()

  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  const change = (path: string, now: unknown, next: unknown) => {
    if (next === undefined || next === (now ?? null)) return
    if (next === null) unset[path] = 1
    else set[path] = next
  }
  if (
    changes.copeDimensions !== undefined &&
    String(changes.copeDimensions) !== String(copeDimensionsOf(o.metadata.COPE_dimension))
  )
    set['metadata.COPE_dimension'] = changes.copeDimensions
  change('severity', o.severity, changes.severity)
  if (changes.locationId && !o.location.equals(changes.locationId))
    set.location = changes.locationId
  change('standard', o.standard, changes.standard)
  change('note', o.note, changes.note)
  if (!Object.keys(set).length && !Object.keys(unset).length) return toDto(o, locations)

  // Removing the note matches only while a recording, photo or page stays, so
  // a removal at the same moment can't leave nothing captured.
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      ...(unset.note && { $or: [KEEPS_RECORDING, KEEPS_PHOTO, KEEPS_PAGE] }),
    },
    { $set: { ...set, edited: stamp(user) }, ...(Object.keys(unset).length && { $unset: unset }) },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  // Deleted, or left with only its note, between the read and the write.
  if (!updated) {
    if (await ObservationModel.exists({ _id: id, deleted: { $exists: true } }))
      throw new ObservationStateError(DELETED)
    throw new EmptyObservationError()
  }
  return toDto(updated, locations)
}

// Adds recordings and photos to a saved observation (CP-08), each stored in S3
// as raw evidence and marked with who added it. Each recording starts its
// transcription. No photo is read until an engineer asks, and a reading of the
// earlier photos shows as out of date. No capture session is needed: like the
// other changes, it is a correction its assigned engineer can make later.
export async function addMedia(
  id: string,
  recordings: NewRecording[],
  photos: NewPhoto[],
  user: SessionUser,
): Promise<ObservationDto> {
  const { observation: o, locations, reference } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  const added = stamp(user)
  const media = storedMedia(reference, o._id, { recordings, photos }, added.at, added)
  const updated = await withUploads(media.files, async () => {
    const saved = await ObservationModel.findOneAndUpdate(
      { _id: id, deleted: { $exists: false } },
      {
        $push: { recordings: { $each: media.recordings }, photos: { $each: media.photos } },
        $set: { edited: added },
      },
      { returnDocument: 'after' },
    ).lean<StoredObservation>()
    // Deleted between the read and the write.
    if (!saved) throw new ObservationStateError(DELETED)
    return saved
  })
  for (const r of media.recordings) void runTranscription(id, String(r._id))
  return toDto(updated, locations)
}

export type MediaKind = 'recordings' | 'photos'
const NOUN = { recordings: 'recording', photos: 'photo' } as const

// Removes a recording or photo from an observation (CP-08), a soft removal:
// it is marked with who removed it and when, its file stays in S3, and it is
// no longer evidence, so drafting and the photo collection leave it out.
// Something must stay captured; matching on that in the update makes it
// atomic, so two removals at once can't leave nothing.
export function removeMedia(id: string, kind: MediaKind, itemId: string, user: SessionUser) {
  return setRemoved(id, kind, itemId, user, true)
}
// Restores a removed recording or photo, back into evidence (CP-08).
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
  // Why the change can't be made to the observation as it stands, if it can't.
  const refusal = (o: StoredObservation) => {
    if (o.deleted) return new ObservationStateError(DELETED)
    const found = ((kind === 'recordings' ? o.recordings : o.photos) ?? []).find((i) =>
      i._id.equals(item),
    )
    if (!found) return new ObservationNotFoundError(noun)
    if (remove && found.removed)
      return new ObservationStateError(`This ${noun} is already removed.`)
    if (!remove && !found.removed) return new ObservationStateError(`This ${noun} is not removed.`)
    const others = (items: { _id: Types.ObjectId; removed?: IStamp }[]) =>
      kept(items).some((i) => !i._id.equals(item))
    if (remove && !o.note && !others(o.recordings) && !others(o.photos ?? []) && !o.pages?.length)
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
  // Something else stays captured: a note, another recording or photo, or a page.
  if (remove)
    filter.$or = [
      { note: { $type: 'string', $ne: '' } },
      ...(['recordings', 'photos'] as const).map((k) => ({
        [k]: {
          $elemMatch: { removed: { $exists: false }, ...(k === kind && { _id: { $ne: item } }) },
        },
      })),
      KEEPS_PAGE,
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
  return toDto(updated, locations)
}

// Corrects a finished transcript (CP-08 AC10). Whisper's words stay as they
// are, as evidence of what was said; drafting uses the correction. Writing
// Whisper's words back removes the correction. Matching on the transcribed
// status makes it atomic, so a recording still transcribing is never corrected.
export async function correctTranscript(
  id: string,
  recordingId: string,
  text: string,
  user: SessionUser,
): Promise<ObservationDto> {
  const { observation: o, locations } = await changeable(id, user)
  if (o.deleted) throw new ObservationStateError(DELETED)
  const recording = isValidObjectId(recordingId)
    ? o.recordings.find((r) => r._id.equals(recordingId))
    : undefined
  if (!recording) throw new ObservationNotFoundError('recording')
  if (recording.removed)
    throw new ObservationStateError(
      'This recording is removed. Restore it before correcting its transcript.',
    )
  const { status, transcript, correction } = recording.transcription
  if (status !== 'transcribed')
    throw new ObservationStateError('Only a finished transcription can be corrected.')
  if (text === (correction?.text ?? transcript)) return toDto(o, locations)

  const now = stamp(user)
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      recordings: {
        $elemMatch: {
          _id: recordingId,
          'transcription.status': 'transcribed',
          removed: { $exists: false },
        },
      },
    },
    text === transcript
      ? { $set: { edited: now }, $unset: { 'recordings.$.transcription.correction': 1 } }
      : { $set: { edited: now, 'recordings.$.transcription.correction': { text, ...now } } },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) throw new ObservationStateError(DELETED)
  return toDto(updated, locations)
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
  return toDto(updated, locations)
}

// Every observation of the assessment, newest first. Deleted ones are left
// out (CP-08 AC13), so the list, section evidence counts and drafting never
// read them, unless asked for.
export async function listObservations(
  reference: string,
  { includeDeleted = false } = {},
): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({
    assessment: assessment._id,
    ...(!includeDeleted && { deleted: { $exists: false } }),
  })
    .sort({ createdAt: -1 })
    .lean<StoredObservation[]>()
  return observations.map((o) => toDto(o, assessment.locations ?? []))
}

// The drafting inputs for one COPE category, oldest first, for section
// generation (GN-01). An observation not categorised yet has a null
// COPE_dimension, so it is left out until it is categorised (CP-02 AC4), and
// so is a deleted one (CP-08 AC13).
export async function listCategoryObservations(
  reference: string,
  copeDimension: CopeDimension,
): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({
    assessment: assessment._id,
    'metadata.COPE_dimension': copeDimension,
    deleted: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .lean<StoredObservation[]>()
  return observations.map((o) => toDto(o, assessment.locations ?? []))
}

// Starts a new attempt for the same recording (CP-03 AC7). Matching on the
// failed status makes it atomic, so a double click cannot start two attempts.
// A removed recording (CP-08) is not retried until it is restored.
export async function retryTranscription(id: string, recordingId: string): Promise<void> {
  if (!isValidObjectId(id) || !isValidObjectId(recordingId)) throw new ObservationNotFoundError()
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
  void runTranscription(id, recordingId)
}

// Runs the recording's latest attempt and records its outcome. Never throws: a
// failure is stored as the reason the engineer sees (CP-03 AC6). Updates only
// this recording, so the observation's other recordings can finish alongside.
// ponytail: runs in the gateway process with no broker (DECISIONS 2026-09-07);
// move to a job collection and worker once volume or restarts matter.
export async function runTranscription(id: string, recordingId: string): Promise<void> {
  const observation = await ObservationModel.findOne(
    { _id: id, 'recordings._id': recordingId },
    { 'recordings.$': 1, assessment: 1 },
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const recording = observation?.recordings[0]
  if (!recording) return
  // The assessment reference tags the Whisper usage record (EV-03).
  const reportId = (
    await AssessmentModel.findById(observation!.assessment, { reference: 1 })
      .lean()
      .catch(() => null)
  )?.reference
  const attempt = `recordings.$.transcription.attempts.${recording.transcription.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    outcome = {
      'recordings.$.transcription.transcript': await transcribe(recording.key, reportId),
      'recordings.$.transcription.status': 'transcribed',
    }
  } catch (error) {
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
  ).catch((error) => console.error('Saving transcription failed:', error))
}

// Starts a new attempt for the same handwritten page (CP-19 AC11), as for a
// recording: matching on the failed status makes it atomic, so a double click
// cannot start two attempts.
export async function retryPageTranscription(id: string, pageId: string): Promise<void> {
  if (!isValidObjectId(id) || !isValidObjectId(pageId)) throw new ObservationNotFoundError()
  const { matchedCount } = await ObservationModel.updateOne(
    { _id: id, pages: { $elemMatch: { _id: pageId, 'transcription.status': 'failed' } } },
    {
      $set: { 'pages.$.transcription.status': 'transcribing' },
      $unset: { 'pages.$.transcription.error': 1 },
      $push: { 'pages.$.transcription.attempts': { startedAt: new Date() } },
    },
  )
  if (!matchedCount) {
    if (await ObservationModel.exists({ _id: id, 'pages._id': pageId })) {
      throw new NotRetryableError()
    }
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
// a draft that used it keeps its own copy and shows as out of date. Matching
// on the transcribed status makes it atomic, so a double click starts one.
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
  if (page.transcription.status === 'failed')
    throw new ObservationStateError('This page’s transcription failed. Retry it instead.')
  if (page.transcription.status === 'transcribing')
    throw new ObservationStateError('This page is already being transcribed.')

  const now = stamp(user)
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      pages: { $elemMatch: { _id: pageId, 'transcription.status': 'transcribed' } },
    },
    {
      $set: { 'pages.$.transcription.status': 'transcribing', edited: now },
      $unset: {
        'pages.$.transcription.transcript': 1,
        'pages.$.transcription.uncertain': 1,
        'pages.$.transcription.provenance': 1,
        'pages.$.transcription.error': 1,
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
}

// A restart loses any attempt still running in memory, a recording's or a
// handwritten page's; mark it failed so the engineer sees why and can retry,
// rather than waiting on Transcribing forever.
export async function failInterruptedTranscriptions() {
  for (const kind of ['recordings', 'pages'] as const) {
    await ObservationModel.updateMany(
      { [`${kind}.transcription.status`]: 'transcribing' },
      {
        $set: {
          [`${kind}.$[r].transcription.status`]: 'failed',
          [`${kind}.$[r].transcription.error`]:
            'Transcription was interrupted by a gateway restart. Retry it.',
        },
      },
      { arrayFilters: [{ 'r.transcription.status': 'transcribing' }] },
    )
  }
}

// The parts of a proposal that can be read again one at a time (CP-21).
export const READING_PARTS = ['categories', 'description'] as const
export type ReadingPart = (typeof READING_PARTS)[number]

// Reads an observation when an engineer asks (CP-05, CP-21): saving never
// sends anything to the model, so a client's notes and site photos leave the
// system only by choice. The first time, or without `part`, it reads both
// parts in one call: the categories, and with photos, their description. With
// `part`, it reads that part again, replacing it, whenever the engineer asks:
// after a failure, once what it reads changed (CP-08), or for another proposal.
// Each reading records everything it reads. The categories wait for
// transcriptions still running and leave out a recording or page with no
// transcript; the description reads the photos, with the note as a hint.
// Matching on the state it found makes it atomic, so a double click cannot
// start two.
export async function readObservation(id: string, part?: ReadingPart): Promise<void> {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const o = await ObservationModel.findById(
    id,
    'note recordings pages photos interpretation deleted',
  ).lean<StoredObservation>()
  if (!o) throw new ObservationNotFoundError()
  if (o.deleted) throw new ObservationStateError(DELETED)
  const items = readingItems(o)
  const photoIds = items.filter((item) => item.kind === 'photo').map((item) => item.id!)
  const parts: ReadingPart[] = part
    ? [part]
    : ['categories', ...(photoIds.length ? (['description'] as const) : [])]
  const reading = o.interpretation
  const photoReading = reading?.photoReading
  const busy = 'It is already being read.'

  if (parts.includes('categories')) {
    const transcribing = [...kept(o.recordings), ...(o.pages ?? [])].some(
      (item) => item.transcription.status === 'transcribing',
    )
    if (transcribing)
      throw new ObservationStateError(
        'Its recordings and pages are still being transcribed. Try again once they finish.',
      )
    if (!items.some((item) => item.kind === 'photo' || item.text))
      throw new ObservationStateError('This observation has nothing to read yet.')
    if (reading?.status === 'interpreting') throw new ObservationStateError(busy)
  }
  if (parts.includes('description')) {
    if (!photoIds.length)
      throw new ObservationStateError('This observation has no photos to describe.')
    if (photoReadingOf(o)?.status === 'interpreting') throw new ObservationStateError(busy)
  }

  const attempt = { startedAt: new Date() }
  const started = { status: 'interpreting', attempts: [attempt], photoIds }
  const filter: Record<string, unknown> = { _id: id, deleted: { $exists: false } }
  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  const push: Record<string, unknown> = {}
  if (!reading) {
    filter.interpretation = { $exists: false }
    set.interpretation = {
      ...started,
      items,
      ...(parts.includes('description') && { photoReading: started }),
    }
  } else {
    // The photos' description, wherever a reading kept it, now lives in its
    // own part: one from before the parts were split moves there.
    unset['interpretation.description'] = 1
    unset['interpretation.hazardType'] = 1
    if (parts.includes('categories')) {
      filter['interpretation.status'] = reading.status
      Object.assign(set, {
        'interpretation.status': 'interpreting',
        'interpretation.photoIds': photoIds,
        'interpretation.items': items,
      })
      // The categories always match what their reading names.
      for (const field of ['error', 'categories', 'copeDimension', 'provenance'])
        unset[`interpretation.${field}`] = 1
      push['interpretation.attempts'] = attempt
    }
    if (parts.includes('description') && photoReading) {
      filter['interpretation.photoReading.status'] = photoReading.status
      Object.assign(set, {
        'interpretation.photoReading.status': 'interpreting',
        'interpretation.photoReading.photoIds': photoIds,
      })
      for (const field of ['description', 'hazardType', 'error', 'provenance'])
        unset[`interpretation.photoReading.${field}`] = 1
      push['interpretation.photoReading.attempts'] = attempt
    } else if (parts.includes('description')) {
      filter['interpretation.photoReading'] = { $exists: false }
      set['interpretation.photoReading'] = started
    } else if (!photoReading && photoReadingOf(o)) {
      // Reading the categories alone keeps a description read before the split.
      set['interpretation.photoReading'] = photoReadingOf(o)
    }
  }
  const { matchedCount } = await ObservationModel.updateOne(filter, {
    $set: set,
    ...(Object.keys(unset).length && { $unset: unset }),
    ...(Object.keys(push).length && { $push: push }),
  })
  // Someone else started one between the read and the write.
  if (!matchedCount) throw new ObservationStateError(busy)
  void runInterpretation(id, parts)
}

// Runs the latest attempt at reading the given parts of an observation and
// records the proposal (CP-05 AC3-AC5, CP-21), once an engineer has asked
// (readObservation): one call for the parts together. It reads what the
// attempt names, so a change made while it runs leaves it reading what it
// started with. Never throws: a failure is stored on each part as the reason
// the engineer sees. The model is told where the finding was made and what was
// captured, but not the engineer's categories or severity, so its proposed
// categories are its own. Each quote it gives is checked against the item it
// names. The proposal is not drafting evidence, so a draft never reads it and
// never goes out of date because of it.
// ponytail: runs in the gateway process, like runTranscription.
export async function runInterpretation(
  id: string,
  parts: ReadingPart[] = [...READING_PARTS],
): Promise<void> {
  const observation = await ObservationModel.findById(
    id,
    'assessment photos note location interpretation',
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const reading = observation?.interpretation
  if (!reading) return
  const categories = parts.includes('categories')
  // The categories read every item their attempt names; the description alone
  // reads the photos its attempt names, under their own names, with the note.
  const items: IReadItem[] = categories
    ? (reading.items ?? [])
    : [
        ...(observation.note?.trim()
          ? [{ label: 'Note', kind: 'note' as const, text: observation.note }]
          : []),
        ...(reading.photoReading?.photoIds ?? []).map((photoId) => ({
          label: observation.photos?.find((p) => p._id.equals(photoId))?.name ?? 'Photo',
          kind: 'photo' as const,
          id: photoId,
        })),
      ]
  const photos = items.flatMap((item) => {
    const photo = item.kind === 'photo' && observation.photos?.find((p) => p._id.equals(item.id!))
    return photo ? [{ label: item.label, s3Key: photo.key }] : []
  })
  const texts = items.flatMap((item) =>
    item.kind !== 'photo' && item.text
      ? [{ label: item.label, kind: item.kind, text: item.text }]
      : [],
  )
  if (categories ? !photos.length && !texts.length : !photos.length) return
  const assessment = await AssessmentModel.findById(observation.assessment, 'locations reference')
    .lean()
    .catch(() => null)
  const place = assessment?.locations?.find((l) => l._id.equals(observation.location))
  // Each part's latest attempt, finished whatever the outcome.
  const prefix = (p: ReadingPart) =>
    p === 'categories' ? 'interpretation' : 'interpretation.photoReading'
  const attempt = (p: ReadingPart) => {
    const attempts = p === 'categories' ? reading.attempts : (reading.photoReading?.attempts ?? [])
    return `${prefix(p)}.attempts.${attempts.length - 1}`
  }
  let outcome: Record<string, unknown> = {}
  try {
    const started = performance.now()
    const result = await interpret({
      photos,
      texts,
      location: place ? locationText(place) : null,
      parts,
    })
    // EV-03: the paid call, tagged with the assessment. Never throws.
    await recordAiCalls(visionUsageToWire(result, performance.now() - started), {
      reportId: assessment?.reference,
    })
    const provenance = {
      provider: result.provider,
      model: result.model,
      promptVersion: result.prompt_version,
      usage: result.usage && {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        thoughtTokens: result.usage.thought_tokens,
      },
      interpretedAt: new Date(),
    }
    const textOf = new Map(texts.map((t) => [t.label, t.text]))
    const photoLabels = new Set(photos.map((p) => p.label))
    if (categories)
      Object.assign(outcome, {
        'interpretation.status': 'interpreted',
        'interpretation.categories': (result.categories ?? [])
          .filter((c): c is typeof c & { category: CopeDimension } =>
            (COPE_DIMENSIONS as readonly string[]).includes(c.category),
          )
          .map((c) => ({
            category: c.category,
            reason: c.reason,
            evidence: c.evidence.map((e) =>
              // A photo has no words: any quote given for one is dropped.
              photoLabels.has(e.item)
                ? { item: e.item, verified: null }
                : {
                    item: e.item,
                    ...(e.quote && { quote: e.quote }),
                    verified: textOf.has(e.item) && quoteFound(e.quote, textOf.get(e.item)!),
                  },
            ),
          })),
        'interpretation.provenance': provenance,
      })
    if (parts.includes('description'))
      Object.assign(outcome, {
        'interpretation.photoReading.status': 'interpreted',
        'interpretation.photoReading.description': result.description,
        'interpretation.photoReading.hazardType': result.hazard_type,
        'interpretation.photoReading.provenance': provenance,
      })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Interpretation failed.'
    outcome = {}
    for (const p of parts)
      Object.assign(outcome, {
        [`${prefix(p)}.status`]: 'failed',
        [`${prefix(p)}.error`]: reason,
        [`${attempt(p)}.error`]: reason,
      })
  }
  for (const p of parts) outcome[`${attempt(p)}.finishedAt`] = new Date()
  await ObservationModel.updateOne({ _id: id }, { $set: outcome }).catch((error) =>
    console.error('Saving interpretation failed:', error),
  )
}

// As for transcriptions: a restart loses an attempt still running in memory,
// so mark each part still running as failed with the reason, ready to retry.
export async function failInterruptedInterpretations() {
  const reason = 'Interpretation was interrupted by a gateway restart. Retry it.'
  for (const prefix of ['interpretation', 'interpretation.photoReading'])
    await ObservationModel.updateMany(
      { [`${prefix}.status`]: 'interpreting' },
      { $set: { [`${prefix}.status`]: 'failed', [`${prefix}.error`]: reason } },
    )
}

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
    stream: await storage.getObjectStream(recording.key),
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
    stream: await storage.getObjectStream(photo.key),
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
