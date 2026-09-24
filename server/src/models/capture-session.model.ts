import { Schema, Types, model } from 'mongoose'

// `ready_for_generation` is the terminal state set by CP-14 (complete a site
// assessment). Only `active` sessions accept new observations.
export const CAPTURE_SESSION_STATUSES = ['active', 'ready_for_generation'] as const
export type CaptureSessionStatus = (typeof CAPTURE_SESSION_STATUSES)[number]

export interface ICaptureSession {
  assessment: Types.ObjectId
  status: CaptureSessionStatus
  createdAt: Date
  updatedAt: Date
}

const captureSessionSchema = new Schema<ICaptureSession>(
  {
    assessment: {
      type: Schema.Types.ObjectId,
      ref: 'Assessment',
      required: true,
    },
    status: {
      type: String,
      enum: CAPTURE_SESSION_STATUSES,
      required: true,
      default: 'active',
    },
  },
  {
    timestamps: true,
    collection: 'capture_sessions',
  },
)

// At most one active session per assessment, enforced by the database so two
// devices opening capture at the same moment cannot both create one. Completed
// sessions fall outside the filter, so an assessment keeps its history.
captureSessionSchema.index(
  { assessment: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)

export const CaptureSessionModel = model<ICaptureSession>('CaptureSession', captureSessionSchema)
