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
  type IRecording,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { AssessmentNotFoundError } from './capture-session.service'
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

// The body of PATCH /api/observations/:id (CP-06). A tag left out stays as it
// is; null uncategorises the observation, and null or '' removes the standard.
export const observationTagsSchema = z.object({
  copeDimension: copeDimensionField.optional(),
  severity: severityField.optional(),
  locationId: locationIdField.optional(),
  standard: standardField
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
})
export type ObservationTags = z.infer<typeof observationTagsSchema>
export type NewRecording = { name: string; audio: Buffer; contentType: string }

export type ObservationDto = {
  id: string
  engineer: string
  engineerId: string | null
  noteType: 'Text' | null
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
      transcript: string | null
      error: string | null
      attempts: number
    }
  }[]
  // When it was captured (CP-02 AC2).
  recordedAt: Date
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
    noteType: o.note ? 'Text' : null,
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
        error: transcriptionFailureReason(r.transcription.error),
        attempts: r.transcription.attempts.length,
      },
    })),
    recordedAt: o.createdAt,
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

// Saves one observation with its note and recordings against the assessment's
// active capture session. Each recording goes to S3 as raw evidence (CP-03
// AC1) and starts its initial transcription (AC3). The session stays active, so
// the engineer can keep adding observations.
export async function saveObservation(
  reference: string,
  details: ObservationDetails,
  recordings: NewRecording[],
  user: SessionUser,
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

  // No transactions on a standalone mongod, so undo the uploads by hand.
  const undo = () =>
    Promise.all(stored.map((r) => storage.deleteObject(r.key).catch(() => undefined)))
  let observation
  try {
    await Promise.all(
      stored.map((r, i) => storage.putObject(r.key, recordings[i].audio, r.contentType)),
    )
    observation = await ObservationModel.create({
      _id: id,
      assessment: assessment._id,
      session: session._id,
      engineer: user.name,
      engineerId: user.id,
      note: details.note,
      recordings: stored,
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

// Changes an observation's tags (CP-06): its category, severity, location and
// standard. They cover the note and every recording, so they are set once.
// Categorising an uncategorised observation brings it into drafting (CP-02 AC4).
// ponytail: tags are overwritten in place. Keeping the prior version once
// drafts cite observations is CP-08 (AC5), and the capture snapshot is CP-14.
export async function updateObservationTags(
  id: string,
  tags: ObservationTags,
): Promise<ObservationDto> {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findById(id, 'assessment').lean()
  if (!observation) throw new ObservationNotFoundError()
  const assessment = await AssessmentModel.findById(observation.assessment, 'locations').lean()
  const locations = assessment?.locations ?? []
  if (tags.locationId && !locations.some((l) => l._id.equals(tags.locationId)))
    throw new UnknownLocationError()

  const set: Record<string, unknown> = {}
  if (tags.copeDimension !== undefined) set['metadata.COPE_dimension'] = tags.copeDimension
  if (tags.severity) set.severity = tags.severity
  if (tags.locationId) set.location = tags.locationId
  if (tags.standard) set.standard = tags.standard
  const updated = await ObservationModel.findByIdAndUpdate(
    id,
    { $set: set, ...(tags.standard === null && { $unset: { standard: 1 } }) },
    { returnDocument: 'after' },
  ).lean<StoredObservation>()
  if (!updated) throw new ObservationNotFoundError()
  return toDto(updated, locations)
}

// Every observation of the assessment, newest first.
export async function listObservations(reference: string): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({ assessment: assessment._id })
    .sort({ createdAt: -1 })
    .lean<StoredObservation[]>()
  return observations.map((o) => toDto(o, assessment.locations ?? []))
}

// The drafting inputs for one COPE category, oldest first, for section
// generation (GN-01). An observation not categorised yet has a null
// COPE_dimension, so it is left out until it is categorised (CP-02 AC4).
export async function listCategoryObservations(
  reference: string,
  copeDimension: CopeDimension,
): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({
    assessment: assessment._id,
    'metadata.COPE_dimension': copeDimension,
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
