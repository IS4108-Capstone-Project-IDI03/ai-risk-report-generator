import { Schema, Types, model } from 'mongoose'

// One drafted Opportunity for Improvement for the report's Section 3 (GN-05).
// It is a suggestion until the engineer accepts it; only accepted OFIs are in
// the report. Written by ofi.service; see docs/areas/database.md.
export const OFI_STATES = ['suggested', 'accepted'] as const

export interface IReportOfi {
  assessment: Types.ObjectId
  state: (typeof OFI_STATES)[number]
  acceptedAt?: Date
  acceptedBy?: Types.ObjectId
  // The model's fields, from the value lists in rag-service generation/ofi.json.
  title: string
  category: string
  type: string
  description: string
  observation: string
  likelihood: string
  consequence: string
  effort: string
  // From the Risk Assessment Matrix, set by S4's code (AC6).
  priority: string
  // Observation ids it rests on, cited standards (`C:`), and the past-report OFI
  // (`P:`) it was adapted from, with those passages for display (AC2).
  observations: string[]
  standards: string[]
  precedent: string | null
  sources: Record<string, unknown>
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    config_version: string
    generated_at: Date
  }
  createdBy: Types.ObjectId
  // Required on every document (see CLAUDE.md). An OFI can address any
  // category, so COPE_dimension is 'all'.
  metadata: {
    source_type: 'ofi'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const required = { type: String, required: true }

const reportOfiSchema = new Schema<IReportOfi>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    state: { type: String, enum: OFI_STATES, required: true },
    acceptedAt: Date,
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    title: required,
    category: required,
    type: required,
    description: required,
    observation: required,
    likelihood: required,
    consequence: required,
    effort: required,
    priority: required,
    observations: { type: [String], default: [] },
    standards: { type: [String], default: [] },
    precedent: { type: String, default: null },
    sources: { type: Schema.Types.Mixed, default: {} },
    provenance: {
      provider: required,
      model: required,
      effort: required,
      prompt_version: required,
      config_version: required,
      generated_at: { type: Date, required: true },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: {
      source_type: { type: String, enum: ['ofi'], required: true },
      jurisdiction: required,
      facility_type: required,
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'report_ofis' },
)

reportOfiSchema.index({ assessment: 1, state: 1 })

export const ReportOfiModel = model<IReportOfi>('ReportOfi', reportOfiSchema)
