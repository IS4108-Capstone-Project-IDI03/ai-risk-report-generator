import { Schema, Types, model } from 'mongoose'
import { COPE_DIMENSIONS, type CopeDimension } from './observation.model'

// One generated draft of one report section (GN-01). Each request saves a new
// document, so earlier drafts stay as they were; the newest is the current one.
export interface IReportSection {
  assessment: Types.ObjectId
  // The template's section number, '7' to '12'.
  sectionId: string
  title: string
  // In the template's order. A statement cites observations (`O:<id>`) or
  // standard passages (`C:<chunk id>`); `supported` is false when a citation
  // does not resolve.
  subsections: {
    heading: string
    kind: 'narrative' | 'fields' | 'table'
    statements: { text: string; citations: string[]; supported: boolean }[]
  }[]
  // The cited standard passages, by citation ID, with their page and headings.
  sources: Record<string, unknown>
  // Up to three questions for the engineer about gaps the evidence leaves.
  questions: string[]
  // The observations the draft was given, as they were then: the record that a
  // later edit to an observation cannot change.
  evidence: {
    id: string
    COPE_dimension: CopeDimension
    note: string | null
    transcripts: string[]
    severity: string
    location: string | null
    standard: string | null
  }[]
  guardrail: { passed: boolean; unsupported_count: number }
  // The configuration that wrote the draft (AC7).
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    template_version: string
    generated_at: Date
  }
  createdBy: Types.ObjectId
  // Required on every document (see CLAUDE.md). COPE_dimension is the
  // section's one category, or 'all' when it draws on several.
  metadata: {
    source_type: 'report_section'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const reportSectionSchema = new Schema<IReportSection>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    sectionId: { type: String, required: true },
    title: { type: String, required: true },
    subsections: [
      {
        _id: false,
        heading: { type: String, required: true },
        kind: { type: String, enum: ['narrative', 'fields', 'table'], required: true },
        statements: [
          {
            _id: false,
            text: { type: String, required: true },
            citations: { type: [String], default: [] },
            supported: { type: Boolean, required: true },
          },
        ],
      },
    ],
    sources: { type: Schema.Types.Mixed, default: {} },
    questions: { type: [String], default: [] },
    evidence: [
      {
        _id: false,
        id: { type: String, required: true },
        COPE_dimension: { type: String, enum: COPE_DIMENSIONS, required: true },
        note: { type: String, default: null },
        transcripts: { type: [String], default: [] },
        severity: { type: String, required: true },
        location: { type: String, default: null },
        standard: { type: String, default: null },
      },
    ],
    guardrail: {
      passed: { type: Boolean, required: true },
      unsupported_count: { type: Number, required: true },
    },
    provenance: {
      provider: { type: String, required: true },
      model: { type: String, required: true },
      effort: { type: String, required: true },
      prompt_version: { type: String, required: true },
      template_version: { type: String, required: true },
      generated_at: { type: Date, required: true },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: {
      source_type: { type: String, enum: ['report_section'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: [...COPE_DIMENSIONS, 'all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'report_sections' },
)

// The newest draft of each section is read most.
reportSectionSchema.index({ assessment: 1, sectionId: 1, createdAt: -1 })

export const ReportSectionModel = model<IReportSection>('ReportSection', reportSectionSchema)
