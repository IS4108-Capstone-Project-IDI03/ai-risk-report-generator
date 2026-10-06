import { Schema, Types, model } from 'mongoose'

export const INGESTION_STAGES = [
  'parsing',
  'anonymising',
  'chunking',
  'indexing',
  'complete',
  'failed',
] as const
export type IngestionStage = (typeof INGESTION_STAGES)[number]

// One completed stage in the audit trail.
export interface IStageLogEntry {
  stage: string
  startedAt: Date
  durationMs: number
}

export interface IIngestionJob {
  documentId: Types.ObjectId
  currentStage: IngestionStage
  // The page being chunked, and the document's total page count (E2b). The
  // chunk count has no knowable total up front, so progress is tracked by
  // page instead. Both null until chunking reaches a page with provenance.
  pageCurrent: number | null
  pageTotal: number | null
  // Completed stages only, oldest first.
  stageLog: IStageLogEntry[]
  currentStageStartedAt: Date
  // Overall job start (= first start_stage call).
  startedAt: Date
  // Set on every write by the worker; not managed by Mongoose timestamps.
  updatedAt: Date
}

const stageLogEntrySchema = new Schema<IStageLogEntry>(
  {
    stage: { type: String, required: true },
    startedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
  },
  { _id: false },
)

const ingestionJobSchema = new Schema<IIngestionJob>(
  {
    documentId: { type: Schema.Types.ObjectId, required: true, unique: true },
    currentStage: { type: String, enum: INGESTION_STAGES, required: true },
    pageCurrent: { type: Number, default: null },
    pageTotal: { type: Number, default: null },
    stageLog: { type: [stageLogEntrySchema], default: [] },
    currentStageStartedAt: { type: Date, required: true },
    startedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  // No `timestamps: true`: the worker controls `updatedAt` explicitly.
  { collection: 'ingestion_jobs' },
)

export const IngestionJobModel = model<IIngestionJob>('IngestionJob', ingestionJobSchema)
