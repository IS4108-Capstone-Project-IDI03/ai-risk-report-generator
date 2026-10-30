// A risk engineer's request that a knowledge admin add a document (CB-07).
// Written by services/knowledge-gap.service.ts. Not retrieval evidence, so it
// carries none of the five mandatory metadata fields (same exemption as notifications).
import { Schema, Types, model } from 'mongoose'

export const GAP_REQUEST_STATUSES = ['open', 'filled', 'dismissed'] as const
export type GapRequestStatus = (typeof GAP_REQUEST_STATUSES)[number]

export interface IKnowledgeGapRequest {
  question: string
  message?: string
  askedBy: Types.ObjectId
  status: GapRequestStatus
  // Set when filled: the knowledge documents the admin says answer it.
  documentIds?: Types.ObjectId[]
  // Set when dismissed.
  reason?: string
  closedBy?: Types.ObjectId
  closedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const knowledgeGapRequestSchema = new Schema<IKnowledgeGapRequest>(
  {
    question: { type: String, required: true, trim: true, maxlength: 4000 },
    message: { type: String, trim: true, maxlength: 1000 },
    askedBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: GAP_REQUEST_STATUSES, default: 'open' },
    documentIds: { type: [Schema.Types.ObjectId], default: undefined },
    reason: { type: String, trim: true, maxlength: 500 },
    closedBy: { type: Schema.Types.ObjectId },
    closedAt: { type: Date },
  },
  { timestamps: true, collection: 'knowledge_gap_requests' },
)

// The admin's open list, newest first.
knowledgeGapRequestSchema.index({ status: 1, createdAt: -1 })

export const KnowledgeGapRequestModel = model<IKnowledgeGapRequest>(
  'KnowledgeGapRequest',
  knowledgeGapRequestSchema,
)
