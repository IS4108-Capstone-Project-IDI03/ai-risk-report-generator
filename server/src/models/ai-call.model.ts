// One paid AI call and what it used (EV-03). Written by ai-usage.service.ts from
// the usage lists the Python services return. Read by EV-04's cost report.
// Ingestion rows are the exception: one row sums a document's calls per stage
// and model (callCount). See docs/areas/database.md.
import { Schema, Types, model } from 'mongoose'

export const AI_FEATURES = [
  'draft-section',
  'retrieval',
  'transcribe',
  'label-document',
  'interpret-photo',
  'ocr',
  'embed-document',
  'chat',
] as const
export const BILLED_SERVICES = [
  'anthropic',
  'cohere-embed',
  'cohere-rerank',
  'openai-whisper',
  'openai-label',
  // The knowledge chat's OpenAI calls (CB-01), priced per token by model.
  'openai',
  'typesafe-jev',
  'gemini-vision',
  'gemini-ocr',
  'self-hosted-ocr',
] as const

export interface IAiCall {
  feature: (typeof AI_FEATURES)[number]
  billedService: (typeof BILLED_SERVICES)[number]
  model: string
  // The assessment reference, e.g. RPT-2026-0901. Absent when no report is involved.
  reportId?: string
  // The knowledge document a labelling or ingestion call was for.
  documentId?: Types.ObjectId
  // Who sent the chat message. Report calls are attributed to the
  // assessment's assigned engineer when the report is read instead.
  userId?: Types.ObjectId
  // The report section a draft was for, e.g. '2.1' or 'Executive summary'.
  section?: string
  // Provider calls this row stands for: 1, or more for a summed ingestion row.
  callCount: number
  durationMs: number | null
  // Null (not 0) when the provider did not report it; see usageStatus.
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  // Cohere rerank billing unit.
  searchUnits: number | null
  // Whisper billing unit.
  audioSeconds: number | null
  // 'unavailable' when the provider gave no usage data at all (AC7).
  usageStatus: 'recorded' | 'unavailable'
  // Null when there is no price for the model or no usage to price.
  estimatedCostUsd: number | null
  // Where the price came from, in words, so a cost can be explained later.
  pricingBasis: string
  createdAt: Date
}

const count = { type: Number, default: null }

const aiCallSchema = new Schema<IAiCall>(
  {
    feature: { type: String, required: true, enum: AI_FEATURES, index: true },
    billedService: { type: String, required: true, enum: BILLED_SERVICES, index: true },
    model: { type: String, required: true },
    reportId: { type: String, index: true },
    documentId: { type: Schema.Types.ObjectId, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    section: { type: String },
    callCount: { type: Number, default: 1, min: 1 },
    durationMs: count,
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    searchUnits: count,
    audioSeconds: count,
    usageStatus: { type: String, required: true, enum: ['recorded', 'unavailable'] },
    estimatedCostUsd: count,
    pricingBasis: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_calls' },
)
// The cost report filters by date range.
aiCallSchema.index({ createdAt: -1 })

export const AiCallModel = model<IAiCall>('AiCall', aiCallSchema)
