import { Schema, Types, model } from 'mongoose'

// A recording's transcription. Saving a recording starts exactly one attempt
// (CP-03 AC3); a retry after a failure adds another for the same audio.
export const TRANSCRIPTION_STATUSES = ['transcribing', 'transcribed', 'failed'] as const
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number]

// The same values the knowledge base tags its chunks with, so retrieval can
// filter observations and documents alike.
export const COPE_DIMENSIONS = ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const
export type CopeDimension = (typeof COPE_DIMENSIONS)[number]

export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface IRecording {
  _id: Types.ObjectId
  // "Recording 2", or the uploaded file's own name.
  name: string
  // The original recording in S3, kept as raw evidence. MongoDB holds only its key.
  key: string
  contentType: string
  size: number
  transcription: {
    status: TranscriptionStatus
    transcript?: string
    // Why the latest attempt failed, shown to the engineer.
    error?: string
    attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
  }
}

// One thing the engineer saw on site, with everything captured about it: a
// note (CP-02) and any number of recordings (CP-03). Photos (CP-04) will join
// as another list.
export interface IObservation {
  assessment: Types.ObjectId
  session: Types.ObjectId
  // Display name at capture time; legacy records may lack a verified engineerId.
  engineer: string
  engineerId?: Types.ObjectId
  // Exactly as the engineer wrote it, never trimmed or reworded.
  note?: string
  recordings: IRecording[]
  // The standard the engineer tied the finding to, if any. The draft finds the
  // clause itself, so only the standard is recorded.
  standard?: string
  // How serious the engineer judged it.
  severity: Severity
  // Where on site: one of the assessment's locations, by its _id.
  location: Types.ObjectId
  // Required on every document (see CLAUDE.md). The COPE dimension is the
  // category the engineer picks when capturing; null means not categorised
  // yet (CP-02 AC4).
  metadata: {
    source_type: 'observation'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | null
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const recordingSchema = new Schema<IRecording>({
  name: { type: String, required: true },
  key: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  transcription: {
    status: { type: String, enum: TRANSCRIPTION_STATUSES, required: true },
    transcript: String,
    error: String,
    attempts: [
      { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
    ],
  },
})

const observationSchema = new Schema<IObservation>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'CaptureSession', required: true },
    engineer: { type: String, required: true, trim: true },
    engineerId: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 5000 },
    recordings: [recordingSchema],
    standard: { type: String, trim: true, maxlength: 100 },
    severity: { type: String, enum: SEVERITIES, required: true },
    location: { type: Schema.Types.ObjectId, required: true },
    metadata: {
      source_type: { type: String, enum: ['observation'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      // Stored as null rather than left out, so the field is always present.
      COPE_dimension: { type: String, enum: COPE_DIMENSIONS, default: null },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'observations' },
)

export const ObservationModel = model<IObservation>('Observation', observationSchema)
