import { Schema, Types, model } from 'mongoose'
import { CONFIDENCE_LEVELS, type ConfidenceLevel } from './assistant-conversation.model'

// A written summary of a client's insights (CP-29): a few statements the model
// drafted from the engineer's own observations and the figures counted from
// them, each citing its sources. One document per write, never changed: the
// client page shows the user's latest one. It is not part of any report.
// Written by client-insight-summary.service; see docs/areas/database.md,
// "Client insights".

// What a statement rests on: one of the engineer's observations, or a figure
// the gateway counted. `n` is the number the statement cites it by.
export interface IInsightSource {
  n: number
  kind: 'observation' | 'figure'
  // An observation: its site and location. A figure: its title.
  title: string
  // An observation: its severity and the day it was captured.
  meta: string | null
  // An observation's own words, or a figure's lines. Never the model's.
  quote: string
  observationId?: Types.ObjectId
  // The assessment the observation belongs to, to open it.
  reference?: string
}

export interface IClientInsightSummary {
  client: Types.ObjectId
  // Who asked: it is written from their assessments, and only they read it back.
  userId: Types.ObjectId
  statements: { text: string; citations: number[] }[]
  // What the evidence did not cover, in the model's words; null for nothing.
  missing: string | null
  // Worked out from the checks, never asked of the model.
  confidence: ConfidenceLevel
  sources: IInsightSource[]
  // What it was written from: how many observations, accepted OFIs and ratings.
  basis: { observations: number; ofis: number; ratings: number }
  // A hash of the figures and observations it was given. A different one now
  // means the summary is out of date.
  fingerprint: string
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    rules_version: string
    generated_at: Date
    // Whether client details were masked before the external AI call, and how
    // many distinct ones (PV-02). Never the values.
    privacy: { enabled: boolean; masked_count: number }
  }
  // Required on every document (see CLAUDE.md). A client has no jurisdiction or
  // facility type of its own, and a summary is not one finding, so the three
  // are null, as a whole-client document's are.
  metadata: {
    source_type: 'client_insight_summary'
    jurisdiction: null
    facility_type: null
    COPE_dimension: null
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const summarySchema = new Schema<IClientInsightSummary>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    statements: [
      { _id: false, text: { type: String, required: true }, citations: { type: [Number] } },
    ],
    missing: { type: String, default: null },
    confidence: { type: String, enum: CONFIDENCE_LEVELS, required: true },
    sources: [
      {
        _id: false,
        n: { type: Number, required: true },
        kind: { type: String, enum: ['observation', 'figure'], required: true },
        title: { type: String, required: true },
        meta: { type: String, default: null },
        quote: { type: String, required: true },
        observationId: { type: Schema.Types.ObjectId, ref: 'Observation' },
        reference: String,
      },
    ],
    basis: {
      observations: { type: Number, required: true },
      ofis: { type: Number, required: true },
      ratings: { type: Number, required: true },
    },
    fingerprint: { type: String, required: true },
    provenance: {
      provider: { type: String, required: true },
      model: { type: String, required: true },
      effort: { type: String, required: true },
      prompt_version: { type: String, required: true },
      rules_version: { type: String, required: true },
      generated_at: { type: Date, required: true },
      privacy: {
        enabled: { type: Boolean, required: true },
        masked_count: { type: Number, required: true },
      },
    },
    metadata: {
      source_type: { type: String, enum: ['client_insight_summary'], required: true },
      jurisdiction: { type: String, default: null },
      facility_type: { type: String, default: null },
      COPE_dimension: { type: Schema.Types.Mixed, default: null },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'client_insight_summaries' },
)

// The page reads one user's latest summary of one client.
summarySchema.index({ client: 1, userId: 1, createdAt: -1 })

export const ClientInsightSummaryModel = model<IClientInsightSummary>(
  'ClientInsightSummary',
  summarySchema,
)
