import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import {
  COPE_DIMENSIONS,
  ObservationModel,
  SEVERITIES,
  type CopeDimension,
  type IObservation,
  type IPhoto,
  type IRecording,
  type IStamp,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { toLocationDto, type LocationDto } from './location.service'
import { transcribe } from './speech.service'
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
  constructor() {
    super('Only a failed transcription can be retried.')
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
// Removing the note would leave the observation with nothing captured.
export class EmptyObservationError extends Error {
  constructor() {
    super('An observation needs a note, a recording or a photo, so this note can’t be removed.')
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
const copeDimensionField = z
  .enum(
    COPE_DIMENSIONS,
    'Choose a COPE category (Construction, Occupancy, Protection or Exposure), or null to leave it uncategorised.',
  )
  .nullable()
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

  // Sent explicitly: null leaves the observation uncategorised (CP-02 AC4).
  copeDimension: copeDimensionField,
  severity: severityField,
  locationId: locationIdField,
  standard: standardField.optional().transform((value) => value || undefined),
})
export type ObservationDetails = z.infer<typeof newObservationSchema>

// The body of PATCH /api/observations/:id: its tags (CP-06) and note (CP-08).
// A field left out stays as it is; null uncategorises the observation, and
// null or '' removes the standard. The note is stored exactly as written, and
// null or a blank one removes it.
export const observationChangesSchema = z.object({
  copeDimension: copeDimensionField.optional(),
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

export type ObservationDto = {
  id: string
  engineer: string
  engineerId: string | null
  // null when not categorised yet.
  copeDimension: CopeDimension | null
  standard: string | null
  severity: IObservation['severity']
  // null only if the location is no longer listed.
  location: LocationDto | null
  note: string | null
  recordings: {
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
  }[]
  // Each links to its original image (CP-04 AC2).
  photos: {
    type: 'Photo'
    id: string
    name: string
    contentType: IPhoto['contentType']
    size: number
    url: string
  }[]
  // When it was captured (CP-02 AC2).
  recordedAt: Date
  // The latest change to its tags, note or a transcript (CP-08).
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

function toDto(o: StoredObservation, locations: ILocation[]): ObservationDto {
  const location = locations.find((l) => l._id.equals(o.location))
  return {
    id: String(o._id),
    engineer: o.engineer,
    engineerId: o.engineerId ? String(o.engineerId) : null,
    copeDimension: o.metadata.COPE_dimension ?? null,
    standard: o.standard ?? null,
    severity: o.severity,
    location: location ? toLocationDto(location) : null,
    note: o.note ?? null,
    recordings: o.recordings.map((r) => ({
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
    })),
    photos: (o.photos ?? []).map((p) => ({
      type: 'Photo',
      id: String(p._id),
      name: p.name,
      contentType: p.contentType,
      size: p.size,
      url: `/api/observations/${o._id}/photos/${p._id}/image`,
    })),
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
// transcription (CP-03 AC3). The session stays active, so the engineer can
// keep adding observations.
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
  const stored = recordings.map((r) => {
    const recordingId = new Types.ObjectId()
    return {
      _id: recordingId,
      name: r.name,
      key: `audio/${reference}/${id}/${recordingId}.${audioExtension(r.contentType)}`,
      contentType: r.contentType,
      size: r.audio.length,
      transcription: { status: 'transcribing' as const, attempts: [{ startedAt: now }] },
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
    }
  })

  // No transactions on a standalone mongod, so undo the uploads by hand.
  const keys = [...stored, ...storedPhotos].map((file) => file.key)
  const undo = () =>
    Promise.all(keys.map((key) => storage.deleteObject(key).catch(() => undefined)))
  let observation
  try {
    await Promise.all([
      ...stored.map((r, i) => storage.putObject(r.key, recordings[i].audio, r.contentType)),
      ...storedPhotos.map((p, i) => storage.putObject(p.key, photos[i].image, p.contentType)),
    ])
    observation = await ObservationModel.create({
      _id: id,
      assessment: assessment._id,
      session: session._id,
      engineer: user.name,
      engineerId: user.id,
      note: details.note,
      recordings: stored,
      photos: storedPhotos,
      standard: details.standard,
      severity: details.severity,
      location: details.locationId,
      metadata: {
        source_type: 'observation',
        jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
        facility_type: assessment.site?.facilityType ?? 'unknown',
        COPE_dimension: details.copeDimension,
        effective_date: now,
      },
    })
  } catch (error) {
    await undo()
    throw error
  }

  for (const r of stored) void runTranscription(String(id), String(r._id))
  return toDto(observation.toObject(), locations)
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
  return { observation, locations: assessment.locations ?? [] }
}

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
  if (changes.note === null && !o.recordings.length && !o.photos?.length)
    throw new EmptyObservationError()

  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  const change = (path: string, now: unknown, next: unknown) => {
    if (next === undefined || next === (now ?? null)) return
    if (next === null) unset[path] = 1
    else set[path] = next
  }
  if (changes.copeDimension !== undefined && changes.copeDimension !== o.metadata.COPE_dimension)
    set['metadata.COPE_dimension'] = changes.copeDimension
  change('severity', o.severity, changes.severity)
  if (changes.locationId && !o.location.equals(changes.locationId))
    set.location = changes.locationId
  change('standard', o.standard, changes.standard)
  change('note', o.note, changes.note)
  if (!Object.keys(set).length && !Object.keys(unset).length) return toDto(o, locations)

  const updated = await ObservationModel.findOneAndUpdate(
    { _id: id, deleted: { $exists: false } },
    { $set: { ...set, edited: stamp(user) }, ...(Object.keys(unset).length && { $unset: unset }) },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  // Deleted between the read and the write.
  if (!updated) throw new ObservationStateError(DELETED)
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
  const { status, transcript, correction } = recording.transcription
  if (status !== 'transcribed')
    throw new ObservationStateError('Only a finished transcription can be corrected.')
  if (text === (correction?.text ?? transcript)) return toDto(o, locations)

  const now = stamp(user)
  const updated = await ObservationModel.findOneAndUpdate(
    {
      _id: id,
      deleted: { $exists: false },
      recordings: { $elemMatch: { _id: recordingId, 'transcription.status': 'transcribed' } },
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
export async function retryTranscription(id: string, recordingId: string): Promise<void> {
  if (!isValidObjectId(id) || !isValidObjectId(recordingId)) throw new ObservationNotFoundError()
  const { matchedCount } = await ObservationModel.updateOne(
    { _id: id, recordings: { $elemMatch: { _id: recordingId, 'transcription.status': 'failed' } } },
    {
      $set: { 'recordings.$.transcription.status': 'transcribing' },
      $unset: { 'recordings.$.transcription.error': 1 },
      $push: { 'recordings.$.transcription.attempts': { startedAt: new Date() } },
    },
  )
  if (!matchedCount) {
    if (await ObservationModel.exists({ _id: id, 'recordings._id': recordingId }))
      throw new NotRetryableError()
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
    { 'recordings.$': 1 },
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const recording = observation?.recordings[0]
  if (!recording) return
  const attempt = `recordings.$.transcription.attempts.${recording.transcription.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    outcome = {
      'recordings.$.transcription.transcript': await transcribe(recording.key),
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
