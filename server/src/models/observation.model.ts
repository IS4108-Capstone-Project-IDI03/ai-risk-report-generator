import { Schema, Types, model } from 'mongoose'

// A voice observation's transcription. Saving a recording queues exactly one
// attempt (CP-03 AC3); a retry after a failure adds another for the same audio.
export const TRANSCRIPTION_STATUSES = ['transcribing', 'transcribed', 'failed'] as const
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number]

// The same values the knowledge base tags its chunks with, so retrieval can
// filter observations and documents alike.
export const COPE_DIMENSIONS = ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const
export type CopeDimension = (typeof COPE_DIMENSIONS)[number]

export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface IObservation {
  assessment: Types.ObjectId
  session: Types.ObjectId
  type: 'voice'
  // A name until accounts (F-04) exist, like the assessment's engineers.
  engineer: string
  // The standard the engineer tied the finding to, if any. The draft finds the
  // clause itself, so only the standard is recorded.
  standard?: string
  // What the engineer judged on site: how serious it is, and where.
  severity: Severity
  area?: string
  // The original recording in S3, kept as raw evidence. MongoDB holds only its key.
  audio: { key: string; contentType: string; size: number }
  transcription: {
    status: TranscriptionStatus
    transcript?: string
    // Why the latest attempt failed, shown to the engineer.
    error?: string
    attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
  }
  // Required on every document (see CLAUDE.md). The COPE dimension is the
  // category the engineer picks when capturing.
  metadata: {
    source_type: 'voice'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const observationSchema = new Schema<IObservation>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'CaptureSession', required: true },
    type: { type: String, enum: ['voice'], required: true },
    engineer: { type: String, required: true, trim: true },
    standard: { type: String, trim: true, maxlength: 100 },
    severity: { type: String, enum: SEVERITIES, required: true },
    area: { type: String, trim: true, maxlength: 100 },
    audio: {
      key: { type: String, required: true },
      contentType: { type: String, required: true },
      size: { type: Number, required: true },
    },
    transcription: {
      status: { type: String, enum: TRANSCRIPTION_STATUSES, required: true },
      transcript: String,
      error: String,
      attempts: [
        { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
      ],
    },
    metadata: {
      source_type: { type: String, enum: ['voice'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: COPE_DIMENSIONS, required: true },
      effective_date: { type: Date, required: true },
    },
  },
  {
    timestamps: true,
    collection: 'observations',
  },
)

export const ObservationModel = model<IObservation>('Observation', observationSchema)
