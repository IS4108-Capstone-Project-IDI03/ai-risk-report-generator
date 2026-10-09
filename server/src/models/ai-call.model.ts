// One paid AI call and what it used (EV-03). Written by ai-usage.service.ts from
// the usage lists the Python services return. Read by EV-04's cost report.
import { Schema, model } from 'mongoose'

export const AI_FEATURES = ['draft-section', 'retrieval', 'transcribe', 'label-document'] as const
export const BILLED_SERVICES = [
  'anthropic',
  'cohere-embed',
  'cohere-rerank',
  'openai-whisper',
  'openai-label',
  'typesafe-jev',
] as const

export interface IAiCall {
  feature: (typeof AI_FEATURES)[number]
  billedService: (typeof BILLED_SERVICES)[number]
  model: string
  // The assessment reference, e.g. RPT-2026-0901. Absent when no report is involved.
  reportId?: string
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

export const AiCallModel = model<IAiCall>('AiCall', aiCallSchema)
