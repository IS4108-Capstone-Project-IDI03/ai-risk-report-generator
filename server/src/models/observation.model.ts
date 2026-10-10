import { Schema, Types, model } from 'mongoose'

// A recording's transcription. Saving a recording starts exactly one attempt
// (CP-03 AC3); a retry after a failure adds another for the same audio.
export const TRANSCRIPTION_STATUSES = ['transcribing', 'transcribed', 'failed'] as const
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number]

// The same values the knowledge base tags its chunks with, so retrieval can
// filter observations and documents alike.
export const COPE_DIMENSIONS = ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const
export type CopeDimension = (typeof COPE_DIMENSIONS)[number]

// An observation's COPE categories as stored: an engineer can file one finding
// under several, and null means none yet (CP-02 AC4), never []. Observations
// saved before multiple categories hold one string, which this reads as a list
// of one, so nothing needs migrating before it can be read.
export function copeDimensionsOf(
  stored: CopeDimension | readonly CopeDimension[] | null | undefined,
): CopeDimension[] | null {
  if (!stored) return null
  const list = typeof stored === 'string' ? [stored] : [...stored]
  return list.length ? list : null
}

export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

// Who changed or deleted an observation, and when (CP-08). `by` is the
// signed-in user as they were then, so a later rename doesn't rewrite it.
export interface IStamp {
  at: Date
  by: { id: string; name: string }
}

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
    // The engineer's correction of `transcript` (CP-08). `transcript` stays as
    // Whisper wrote it, as evidence of what was said; drafting uses this.
    correction?: IStamp & { text: string }
  }
  // Who added it to the observation after it was saved, and when (CP-08);
  // absent for one captured with it.
  added?: IStamp
  // Present only while it is removed (CP-08), a soft removal: the audio stays
  // in S3 and restoring removes this. A removed recording is not evidence.
  removed?: IStamp
}

// A site photograph (CP-04), JPG or PNG. Each is its own entry so a later
// annotation (CP-10) can attach to one photo.
export interface IPhoto {
  _id: Types.ObjectId
  // The uploaded file's own name, or "Photo 2".
  name: string
  // The original image in S3, kept as raw evidence and never altered.
  key: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  // As for a recording (CP-08): who added it after saving, and its removal.
  added?: IStamp
  removed?: IStamp
}

// Where reading an observation's photos stands (CP-05). Nothing reads them
// until an engineer asks; each request starts exactly one attempt.
export const INTERPRETATION_STATUSES = ['interpreting', 'interpreted', 'failed'] as const
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number]

// What the vision model proposes from all of an observation's photos (CP-05),
// for the engineer to review. It is never drafting evidence: the engineer
// takes it into the note or the category through Edit if they agree.
export interface IInterpretation {
  status: InterpretationStatus
  description?: string
  // A proposed category, which may differ from the engineer's own.
  copeDimension?: CopeDimension
  // One of S5's hazard types, e.g. "Housekeeping" or "No hazard visible".
  hazardType?: string
  // Why the latest attempt failed, as S5 put it; the DTO makes it readable.
  error?: string
  attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
  // The photos the latest attempt reads, set when it starts (CP-08). Once
  // photos are added or removed, a finished reading of a different set is out
  // of date. Absent on readings from before photos could change, which read
  // every photo the observation was saved with.
  photoIds?: Types.ObjectId[]
  // What wrote it and the tokens it took (EV-03); usage is null when the
  // provider reports none.
  provenance?: {
    provider: string
    model: string
    promptVersion: string
    usage: { inputTokens: number; outputTokens: number | null; thoughtTokens: number | null } | null
    interpretedAt: Date
  }
}

// One thing the engineer saw on site, with everything captured about it: a
// note (CP-02), any number of recordings (CP-03) and photographs (CP-04).
export interface IObservation {
  assessment: Types.ObjectId
  session: Types.ObjectId
  // Display name at capture time; legacy records may lack a verified engineerId.
  engineer: string
  engineerId?: Types.ObjectId
  // Exactly as the engineer wrote it, never trimmed or reworded.
  note?: string
  recordings: IRecording[]
  // Absent on observations saved before CP-04.
  photos?: IPhoto[]
  // Present once an engineer has asked for its photos to be read (CP-05).
  interpretation?: IInterpretation
  // The standard the engineer tied the finding to, if any. The draft finds the
  // clause itself, so only the standard is recorded.
  standard?: string
  // How serious the engineer judged it.
  severity: Severity
  // Where on site: one of the assessment's locations, by its _id.
  location: Types.ObjectId
  // Required on every document (see CLAUDE.md). The COPE dimension holds the
  // categories the engineer picks when capturing, one or more; null means not
  // categorised yet (CP-02 AC4). Read it through copeDimensionsOf, since older
  // observations hold a single string.
  metadata: {
    source_type: 'observation'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension[] | null
    effective_date: Date
  }
  // The latest change to its tags, note, a transcript, or its recordings and
  // photos (CP-08).
  edited?: IStamp
  // Present only while it is deleted (CP-08), a soft delete: nothing is
  // removed, so drafts that cite it stay traceable, and restoring removes this.
  deleted?: IStamp
  createdAt: Date
  updatedAt: Date
}

const stampFields = {
  at: { type: Date, required: true },
  by: {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
}
const stampSchema = new Schema<IStamp>(stampFields, { _id: false })

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
    correction: {
      type: new Schema({ text: { type: String, required: true }, ...stampFields }, { _id: false }),
    },
  },
  added: { type: stampSchema },
  removed: { type: stampSchema },
})

const photoSchema = new Schema<IPhoto>({
  name: { type: String, required: true },
  key: { type: String, required: true },
  contentType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  size: { type: Number, required: true },
  added: { type: stampSchema },
  removed: { type: stampSchema },
})

const interpretationSchema = new Schema<IInterpretation>(
  {
    status: { type: String, enum: INTERPRETATION_STATUSES, required: true },
    description: String,
    copeDimension: { type: String, enum: COPE_DIMENSIONS },
    hazardType: String,
    error: String,
    attempts: [
      { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
    ],
    // Left out rather than defaulting to [], which would read as "no photos".
    photoIds: { type: [Schema.Types.ObjectId], default: undefined },
    provenance: {
      type: new Schema(
        {
          provider: { type: String, required: true },
          model: { type: String, required: true },
          promptVersion: { type: String, required: true },
          usage: {
            type: new Schema(
              { inputTokens: Number, outputTokens: Number, thoughtTokens: Number },
              { _id: false },
            ),
            default: null,
          },
          interpretedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
    },
  },
  { _id: false },
)

const observationSchema = new Schema<IObservation>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'CaptureSession', required: true },
    engineer: { type: String, required: true, trim: true },
    engineerId: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 5000 },
    recordings: [recordingSchema],
    photos: [photoSchema],
    interpretation: { type: interpretationSchema },
    standard: { type: String, trim: true, maxlength: 100 },
    severity: { type: String, enum: SEVERITIES, required: true },
    location: { type: Schema.Types.ObjectId, required: true },
    metadata: {
      source_type: { type: String, enum: ['observation'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      // Stored as null rather than left out or [], so the field is always
      // present and an uncategorised observation reads the same either way.
      COPE_dimension: { type: [{ type: String, enum: COPE_DIMENSIONS }], default: null },
      effective_date: { type: Date, required: true },
    },
    edited: { type: stampSchema },
    deleted: { type: stampSchema },
  },
  { timestamps: true, collection: 'observations' },
)

export const ObservationModel = model<IObservation>('Observation', observationSchema)
