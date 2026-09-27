import { isValidObjectId, Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import {
  COPE_DIMENSIONS,
  ObservationModel,
  SEVERITIES,
  type CopeDimension,
  type IObservation,
  type Severity,
} from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { AssessmentNotFoundError } from './capture-session.service'
import { transcribe } from './speech.service'
import * as storage from './storage.service'

export class NoActiveSessionError extends Error {
  constructor(reference: string) {
    super(`${reference} has no capture session in progress. Open Site observation to start one.`)
    this.name = 'NoActiveSessionError'
  }
}
export class ObservationNotFoundError extends Error {
  constructor() {
    super('The observation was not found.')
    this.name = 'ObservationNotFoundError'
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

export function isCopeDimension(value: string | undefined): value is CopeDimension {
  return COPE_DIMENSIONS.includes(value as CopeDimension)
}

export function isSeverity(value: string | undefined): value is Severity {
  return SEVERITIES.includes(value as Severity)
}

// What the engineer fills in on the capture form alongside the recording.
export type VoiceDetails = {
  engineer: string
  copeDimension: CopeDimension
  severity: Severity
  area?: string
  standard?: string
}

export type ObservationDto = {
  id: string
  type: 'voice'
  engineer: string
  copeDimension: CopeDimension
  standard: string | null
  severity: Severity
  area: string | null
  recordedAt: Date
  audio: { contentType: string; size: number; url: string }
  transcription: {
    status: IObservation['transcription']['status']
    transcript: string | null
    error: string | null
    attempts: number
  }
}

function toDto(o: IObservation & { _id: Types.ObjectId }): ObservationDto {
  return {
    id: String(o._id),
    type: o.type,
    engineer: o.engineer,
    copeDimension: o.metadata.COPE_dimension,
    standard: o.standard ?? null,
    severity: o.severity,
    area: o.area ?? null,
    recordedAt: o.createdAt,
    audio: {
      contentType: o.audio.contentType,
      size: o.audio.size,
      url: `/api/observations/${o._id}/audio`,
    },
    transcription: {
      status: o.transcription.status,
      transcript: o.transcription.transcript ?? null,
      error: o.transcription.error ?? null,
      attempts: o.transcription.attempts.length,
    },
  }
}

// Stores the recording in S3 and records it against the assessment's active
// capture session, then queues its one transcription (CP-03 AC1–AC3). The
// session stays active, so the engineer can keep adding observations.
export async function saveVoiceObservation(
  reference: string,
  audio: Buffer,
  contentType: string,
  details: VoiceDetails,
): Promise<ObservationDto> {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const session = await CaptureSessionModel.findOne({
    assessment: assessment._id,
    status: 'active',
  }).lean()
  if (!session) throw new NoActiveSessionError(reference)

  const id = new Types.ObjectId()
  const key = `audio/${reference}/${id}.${audioExtension(contentType)}`
  await storage.putObject(key, audio, contentType)

  const now = new Date()
  let observation
  try {
    observation = await ObservationModel.create({
      _id: id,
      assessment: assessment._id,
      session: session._id,
      type: 'voice',
      engineer: details.engineer,
      standard: details.standard,
      severity: details.severity,
      area: details.area,
      audio: { key, contentType, size: audio.length },
      transcription: { status: 'transcribing', attempts: [{ startedAt: now }] },
      metadata: {
        source_type: 'voice',
        jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
        facility_type: assessment.site?.facilityType ?? 'unknown',
        COPE_dimension: details.copeDimension,
        effective_date: now,
      },
    })
  } catch (error) {
    // No transactions on a standalone mongod, so undo the upload by hand.
    await storage.deleteObject(key).catch(() => undefined)
    throw error
  }

  void runTranscription(String(id))
  return toDto(observation.toObject())
}

export async function listObservations(reference: string): Promise<ObservationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, '_id').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const observations = await ObservationModel.find({ assessment: assessment._id })
    .sort({ createdAt: -1 })
    .lean()
  return observations.map(toDto)
}

// Starts a new attempt for the same recording (AC7). The status filter makes
// it atomic, so a double click cannot start two attempts.
export async function retryTranscription(id: string): Promise<ObservationDto> {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findOneAndUpdate(
    { _id: id, 'transcription.status': 'failed' },
    {
      $set: { 'transcription.status': 'transcribing' },
      $unset: { 'transcription.error': 1 },
      $push: { 'transcription.attempts': { startedAt: new Date() } },
    },
    { returnDocument: 'after' },
  ).lean()
  if (!observation) {
    if (await ObservationModel.exists({ _id: id })) throw new NotRetryableError()
    throw new ObservationNotFoundError()
  }
  void runTranscription(id)
  return toDto(observation)
}

// Runs the latest attempt and records its outcome. Never throws: a failure is
// stored as the reason the engineer sees (AC6).
// ponytail: runs in the gateway process with no broker (DECISIONS 2026-09-07);
// move to a job collection and worker once volume or restarts matter.
export async function runTranscription(id: string): Promise<void> {
  const observation = await ObservationModel.findById(id).catch(() => null)
  if (!observation) return
  const attempt = observation.transcription.attempts.at(-1)
  try {
    observation.transcription.transcript = await transcribe(observation.audio.key)
    observation.transcription.status = 'transcribed'
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Transcription failed.'
    observation.transcription.status = 'failed'
    observation.transcription.error = reason
    if (attempt) attempt.error = reason
  }
  if (attempt) attempt.finishedAt = new Date()
  await observation.save().catch((error) => console.error('Saving transcription failed:', error))
}

// A restart loses any attempt still running in memory; mark it failed so the
// engineer sees why and can retry, rather than waiting on Transcribing forever.
export async function failInterruptedTranscriptions() {
  await ObservationModel.updateMany(
    { 'transcription.status': 'transcribing' },
    {
      $set: {
        'transcription.status': 'failed',
        'transcription.error': 'Transcription was interrupted by a gateway restart. Retry it.',
      },
    },
  )
}

export async function getObservationAudio(id: string) {
  if (!isValidObjectId(id)) throw new ObservationNotFoundError()
  const observation = await ObservationModel.findById(id, 'audio').lean()
  if (!observation) throw new ObservationNotFoundError()
  return {
    contentType: observation.audio.contentType,
    size: observation.audio.size,
    stream: await storage.getObjectStream(observation.audio.key),
  }
}
