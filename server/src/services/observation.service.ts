import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import {
  COPE_DIMENSIONS,
  copeDimensionsOf,
  ObservationModel,
  SEVERITIES,
  type CopeDimension,
  type IInterpretation,
  type IObservation,
  type IPhoto,
  type IRecording,
  type IStamp,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { toLocationDto, type LocationDto } from './location.service'
import { interpret, transcribe } from './speech.service'
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
// Removing the note, a recording or a photo would leave the observation with
// nothing captured (CP-08).
export class EmptyObservationError extends Error {
  constructor(what: 'note' | 'recording' | 'photo' = 'note') {
    super(
      `An observation needs a note, a recording or a photo, so this ${what} can’t be removed.` +
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
  // Removed ones, with who removed them and when, to restore (CP-08).
  removedRecordings: (RecordingDto & { removed: StampDto })[]
  removedPhotos: (PhotoDto & { removed: StampDto })[]
  // What the vision model proposes from its photos (CP-05), for the engineer
  // to review; null until an engineer asks for its photos to be read, and
  // while none is left.
  interpretation: {
    status: IInterpretation['status']
    description: string | null
    copeDimension: CopeDimension | null
    hazardType: string | null
    error: string | null
    attempts: number
    // The model that wrote it.
    model: string | null
    // The photos it reads (CP-08), removed ones included.
    photoIds: string[]
    // A finished reading of photos other than those it has now (CP-08).
    outOfDate: boolean
  } | null
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

// The same for interpreting photos (CP-05), from S5's message prefixes
// (microservices/speech-ocr-service/app/processors/vision.py).
function interpretationFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The photo could not be read from storage:'))
    return 'A photo could not be read from storage.'
  if (error.startsWith('The photo could not be opened:')) return 'A photo could not be opened.'
  if (error.startsWith('The photos could not be interpreted:'))
    return 'The photo service could not interpret the photos.'
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
// A finished reading of a set of photos other than the ones kept now (CP-08):
// photos were added or removed since it was read.
function readingOutOfDate(o: StoredObservation): boolean {
  if (o.interpretation?.status !== 'interpreted') return false
  const read = readPhotoIds(o)
  const now = kept(o.photos ?? []).map((p) => String(p._id))
  return read.length !== now.length || now.some((id) => !read.includes(id))
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
    removedRecordings: o.recordings
      .filter((r) => r.removed)
      .map((r) => ({ ...recording(r), removed: stampDto(r.removed)! })),
    removedPhotos: photos
      .filter((p) => p.removed)
      .map((p) => ({ ...photo(p), removed: stampDto(p.removed)! })),
    interpretation:
      o.interpretation && keptPhotos.length
        ? {
            status: o.interpretation.status,
            description: o.interpretation.description ?? null,
            copeDimension: o.interpretation.copeDimension ?? null,
            hazardType: o.interpretation.hazardType ?? null,
            error: interpretationFailureReason(o.interpretation.error),
            attempts: o.interpretation.attempts.length,
            model: o.interpretation.provenance?.model ?? null,
            photoIds: readPhotoIds(o),
            outOfDate: readingOutOfDate(o),
          }
        : null,
    recordedAt: o.createdAt,
    edited: stampDto(o.edited),
    deleted: stampDto(o.deleted),
  }
}

// The assessment, with its site, and the capture session in progress that a
// new observation is recorded against. Only an active session accepts one.
async function activeCapture(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const session = await CaptureSessionModel.findOne({
    assessment: assessment._id,
    status: 'active',
  }).lean()
  if (!session) throw new NoActiveSessionError(reference)
  return { assessment, session }
}

// Saves one observation with its note, recordings and photos against the
// assessment's active capture session. Each recording and photo goes to S3 as
// raw evidence (CP-03 AC1, CP-04 AC1), and each recording starts its initial
// transcription (CP-03 AC3). The photos are not read: no photo goes to the
// vision model until an engineer asks (readPhotos). The session stays active,
// so the engineer can keep adding observations.
export async function saveObservation(
  reference: string,
  details: ObservationDetails,
  recordings: NewRecording[],
  user: SessionUser,
  photos: NewPhoto[] = [],
): Promise<ObservationDto> {
  const { assessment, session } = await activeCapture(reference)
  const locations = assessment.locations ?? []
  if (!locations.some((l) => l._id.equals(details.locationId))) throw new UnknownLocationError()
  const id = new Types.ObjectId()
  const now = new Date()
  const media = storedMedia(reference, id, recordings, photos, now)
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
      standard: details.standard,
      severity: details.severity,
      location: details.locationId,
      metadata: {
        source_type: 'observation',
        jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
        facility_type: assessment.site?.facilityType ?? 'unknown',
        COPE_dimension: details.copeDimensions,
        effective_date: now,
      },
    }),
  )

  for (const r of media.recordings) void runTranscription(String(id), String(r._id))
  return toDto(observation.toObject(), locations)
}

// Recordings and photos as an observation stores them, each with its own id
// and an S3 key in the observation's folder, and the files to upload. Each
// recording starts its one transcription attempt (CP-03 AC3). `added` marks
// ones added after the observation was saved (CP-08).
function storedMedia(
  reference: string,
  id: Types.ObjectId,
  recordings: NewRecording[],
  photos: NewPhoto[],
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
  const files = [
    ...storedRecordings.map((r, i) => ({
      key: r.key,
      body: recordings[i].audio,
      type: r.contentType,
    })),
    ...storedPhotos.map((p, i) => ({ key: p.key, body: photos[i].image, type: p.contentType })),
  ]
  return { recordings: storedRecordings, photos: storedPhotos, files }
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

// Matches an observation keeping a recording, or a photo, not removed.
const KEEPS_RECORDING = { recordings: { $elemMatch: { removed: { $exists: false } } } }
const KEEPS_PHOTO = { photos: { $elemMatch: { removed: { $exists: false } } } }

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
  if (changes.note === null && !kept(o.recordings).length && !kept(o.photos ?? []).length)
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

  // Removing the note matches only while a recording or photo stays, so a
  // removal at the same moment can't leave nothing captured.
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      ...(unset.note && { $or: [KEEPS_RECORDING, KEEPS_PHOTO] }),
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
  const media = storedMedia(reference, o._id, recordings, photos, added.at, added)
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
    if (remove && !o.note && !others(o.recordings) && !others(o.photos ?? []))
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
  // Something else stays captured: a note, or another recording or photo.
  if (remove)
    filter.$or = [
      { note: { $type: 'string', $ne: '' } },
      ...(['recordings', 'photos'] as const).map((k) => ({
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

// A restart loses any attempt still running in memory; mark it failed so the
// engineer sees why and can retry, rather than waiting on Transcribing forever.
export async function failInterruptedTranscriptions() {
  await ObservationModel.updateMany(
    { 'recordings.transcription.status': 'transcribing' },
    {
      $set: {
        'recordings.$[r].transcription.status': 'failed',
        'recordings.$[r].transcription.error':
          'Transcription was interrupted by a gateway restart. Retry it.',
      },
    },
    { arrayFilters: [{ 'r.transcription.status': 'transcribing' }] },
  )
}

// Reads an observation's photos when an engineer asks (CP-05): saving never
// sends a photo to the vision model, so a client's site photos leave the
// system only by choice. Starts the first reading, a new one after a failure,
// or one of the photos it has now once photos were added or removed since the
// last (CP-08). Each reading records which photos it reads. Matching on the
// state it found makes it atomic, so a double click cannot start two.
export async function readPhotos(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const o = await ObservationModel.findById(
    id,
    'photos interpretation deleted',
  ).lean<StoredObservation>()
  if (!o) throw new ObservationNotFoundError()
  if (o.deleted) throw new ObservationStateError(DELETED)
  const photoIds = kept(o.photos ?? []).map((p) => p._id)
  if (!photoIds.length) throw new ObservationStateError('This observation has no photos to read.')
  const status = o.interpretation?.status
  if (status === 'interpreted' && !readingOutOfDate(o))
    throw new ObservationStateError('Its photos have already been read.')
  const reading = 'Its photos are already being read.'
  if (status === 'interpreting') throw new ObservationStateError(reading)

  const attempt = { startedAt: new Date() }
  const { matchedCount } = await ObservationModel.updateOne(
    {
      _id: id,
      deleted: { $exists: false },
      ...(status ? { 'interpretation.status': status } : { interpretation: { $exists: false } }),
    },
    status
      ? {
          $set: { 'interpretation.status': 'interpreting', 'interpretation.photoIds': photoIds },
          // A proposal always matches the photos its reading names.
          $unset: {
            'interpretation.error': 1,
            'interpretation.description': 1,
            'interpretation.copeDimension': 1,
            'interpretation.hazardType': 1,
            'interpretation.provenance': 1,
          },
          $push: { 'interpretation.attempts': attempt },
        }
      : { $set: { interpretation: { status: 'interpreting', attempts: [attempt], photoIds } } },
  )
  // Someone else started one between the read and the write.
  if (!matchedCount) throw new ObservationStateError(reading)
  void runInterpretation(id)
}

// Runs the latest attempt at reading the observation's photos and records the
// proposal (CP-05 AC3-AC5), once an engineer has asked (readPhotos). It reads
// the photos the attempt names (CP-08), so photos added or removed while it
// runs leave it reading the set it started with. Never throws: a failure is
// stored as the reason the engineer sees. The vision model is told where the
// photos were taken and what the note says, but not the engineer's category or
// severity, so its proposed category is its own. The proposal is not drafting
// evidence, so a draft never reads it and never goes out of date because of it.
// ponytail: runs in the gateway process, like runTranscription.
export async function runInterpretation(id: string): Promise<void> {
  const observation = await ObservationModel.findById(
    id,
    'assessment photos note location interpretation',
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const read = observation && readPhotoIds(observation)
  const photos = (observation?.photos ?? []).filter((p) => read?.includes(String(p._id)))
  if (!observation?.interpretation || !photos.length) return
  const assessment = await AssessmentModel.findById(observation.assessment, 'locations')
    .lean()
    .catch(() => null)
  const place = assessment?.locations?.find((l) => l._id.equals(observation.location))
  const attempt = `interpretation.attempts.${observation.interpretation.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    const result = await interpret({
      s3Keys: photos.map((p) => p.key),
      location: place ? [place.name, place.floor].filter(Boolean).join(' · ') : null,
      note: observation.note ?? null,
    })
    outcome = {
      'interpretation.status': 'interpreted',
      'interpretation.description': result.description,
      'interpretation.copeDimension': result.cope_dimension,
      'interpretation.hazardType': result.hazard_type,
      'interpretation.provenance': {
        provider: result.provider,
        model: result.model,
        promptVersion: result.prompt_version,
        usage: result.usage && {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          thoughtTokens: result.usage.thought_tokens,
        },
        interpretedAt: new Date(),
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Interpretation failed.'
    outcome = {
      'interpretation.status': 'failed',
      'interpretation.error': reason,
      [`${attempt}.error`]: reason,
    }
  }
  await ObservationModel.updateOne(
    { _id: id },
    { $set: { ...outcome, [`${attempt}.finishedAt`]: new Date() } },
  ).catch((error) => console.error('Saving interpretation failed:', error))
}

// As for transcriptions: a restart loses an attempt still running in memory,
// so mark it failed with the reason, ready to retry.
export async function failInterruptedInterpretations() {
  await ObservationModel.updateMany(
    { 'interpretation.status': 'interpreting' },
    {
      $set: {
        'interpretation.status': 'failed',
        'interpretation.error': 'Interpretation was interrupted by a gateway restart. Retry it.',
      },
    },
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
