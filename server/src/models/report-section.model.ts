import { Schema, Types, model } from 'mongoose'
import { COPE_DIMENSIONS, type CopeDimension } from './observation.model'

// One generated draft of one report section (GN-01), or of Section 2's
// Executive Summary (GN-07). Each request saves a new
// document, so earlier drafts stay as they were, and none is ever changed: the
// engineer's decisions on its findings are in the review audit log (RV-02).
// The section's saved content is its newest draft, except that a replacement
// (see `replacementFor`) counts only once accepted, and from when it was.
export interface IReportSection {
  assessment: Types.ObjectId
  // The template's section number: '7' to '12', or '2' for the Executive Summary.
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
  // later edit to an observation cannot change. COPE_dimension lists its
  // categories; drafts saved before an observation could have several hold
  // one string, which copeDimensionsOf reads as a list of one.
  evidence: {
    id: string
    COPE_dimension: CopeDimension[]
    note: string | null
    transcripts: string[]
    // The observation's transcribed handwritten pages (CP-19); absent when it
    // has none, so evidence saved before pages existed compares unchanged.
    handwriting?: string[]
    severity: string
    location: string | null
    standard: string | null
  }[]
  guardrail: { passed: boolean; unsupported_count: number }
  // Sections 4 and 5 (GN-03): the engineer's figures the draft was given, as
  // sent; the draft is out of date once they no longer match.
  facts?: string
  // Section 2 only (GN-07 AC4): the version of each section it summarised, to
  // tell when one has changed since. See summary.service.ts.
  summarised?: { sectionId: string; version: string }[]
  // The configuration that wrote the draft (AC7). `instruction` is what the
  // engineer asked a regenerated draft to change (RV-02), part of its prompt;
  // absent or null otherwise.
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    template_version: string
    generated_at: Date
    instruction?: string | null
  }
  // Set on a replacement draft, made by Regenerate in the review workspace
  // (RV-02): the saved draft it was made to replace. It is not the section's
  // content until the engineer accepts it, and once discarded it never is;
  // both decisions are in the review audit log. Absent on a GN-01 draft.
  replacementFor?: Types.ObjectId
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
    facts: String,
    evidence: [
      {
        _id: false,
        id: { type: String, required: true },
        COPE_dimension: {
          type: [{ type: String, enum: COPE_DIMENSIONS }],
          default: undefined,
          validate: [(v: string[]) => v.length > 0, 'Evidence needs a COPE category.'],
        },
        note: { type: String, default: null },
        transcripts: { type: [String], default: [] },
        // Never defaulted to []: see the interface above.
        handwriting: { type: [String], default: undefined },
        severity: { type: String, required: true },
        location: { type: String, default: null },
        standard: { type: String, default: null },
      },
    ],
    guardrail: {
      passed: { type: Boolean, required: true },
      unsupported_count: { type: Number, required: true },
    },
    summarised: {
      type: [{ _id: false, sectionId: String, version: String }],
      default: undefined,
    },
    provenance: {
      provider: { type: String, required: true },
      model: { type: String, required: true },
      effort: { type: String, required: true },
      prompt_version: { type: String, required: true },
      template_version: { type: String, required: true },
      generated_at: { type: Date, required: true },
      instruction: { type: String, default: null },
    },
    replacementFor: { type: Schema.Types.ObjectId, ref: 'ReportSection' },
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
