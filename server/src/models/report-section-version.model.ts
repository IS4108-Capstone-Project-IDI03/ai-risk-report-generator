import { Schema, Types, model } from 'mongoose'
import { COPE_DIMENSIONS, type CopeDimension, type IStamp } from './observation.model'

// One saved version of a report section as the engineer wrote it in the
// document editor (RV-08): the whole section's text, with its formatting, the
// citation markers where they sit and, for each passage that came from the
// draft, which finding it is. Every save adds a version, so earlier text is
// never lost (RV-06 reads the same versions); none is ever changed.
//
// The section's text in the review workspace is its newest version, while
// that version was made on the section's saved draft (`draft`). Drafts in
// `report_sections` are not changed: what the engineer changed in a drafted
// finding is also an `edit` (or, for a deleted one, `reject`) entry in
// `review_audit_log`, marked `inDocument`, so the finding's state, the review
// summary and the review history stay as RV-02 reads them.
// Written by report-document.service; see docs/areas/database.md.

export const DOCUMENT_MARKS = ['bold', 'italic', 'underline'] as const
export type DocumentMark = (typeof DOCUMENT_MARKS)[number]

// A run of text with its formatting, or a citation marker naming its source:
// `O:<observation id>`, `C:<chunk id>` (a standard), `P:<chunk id>` (a past
// report) or `S:<section>` (Section 2's).
export type DocumentInline =
  | { type: 'text'; text: string; marks?: DocumentMark[] }
  | { type: 'cite'; id: string }
// A paragraph, on its own or as a list item. `finding` is the drafted
// finding it came from, as `<subsection>.<statement>` of the version's draft;
// absent on text the engineer wrote.
export type DocumentParagraph = {
  type: 'paragraph'
  finding?: string | null
  content: DocumentInline[]
}
export type DocumentBlock =
  | DocumentParagraph
  // A sub-heading: one the engineer added, or a finding they set as one,
  // which keeps its `finding`.
  | { type: 'heading'; finding?: string | null; content: DocumentInline[] }
  | { type: 'bulletList' | 'orderedList'; items: DocumentParagraph[] }

// A section's text: what comes before its first subsection (all of it in a
// section with none), then each of the draft's subsections in order, by
// heading. The headings are the template's, fixed; a table subsection holds
// nothing, as measured values fill it.
export type SectionDocument = {
  intro: DocumentBlock[]
  subsections: { heading: string; blocks: DocumentBlock[] }[]
}

export interface IReportSectionVersion {
  assessment: Types.ObjectId
  // '1' to '12', or 'A' for Appendix A.
  sectionId: string
  // 1, 2, 3… per assessment and section. Unique with them, so of two saves
  // made on the same version only one is kept.
  version: number
  // The section's saved draft the text was edited from: its finding keys
  // name that draft's statements. null when the section had no draft.
  draft: Types.ObjectId | null
  document: SectionDocument
  // Who saved it and when.
  by: IStamp['by']
  at: Date
  // Required on every document (see CLAUDE.md), from the site and the
  // section; COPE_dimension is 'all' for sections that draw on several (and
  // for 1, 2, 3 and A). effective_date is when it was saved.
  metadata: {
    source_type: 'report_section_version'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | 'all'
    effective_date: Date
  }
}

export class ImmutableVersionError extends Error {
  constructor() {
    super('A saved section version cannot be changed or deleted; save a new version instead.')
    this.name = 'ImmutableVersionError'
  }
}

const reportSectionVersionSchema = new Schema<IReportSectionVersion>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    sectionId: { type: String, required: true, match: /^(1[0-2]|[1-9]|A)$/ },
    version: { type: Number, required: true, min: 1 },
    draft: { type: Schema.Types.ObjectId, ref: 'ReportSection', default: null },
    // Validated by report-document.service before it is saved.
    document: { type: Schema.Types.Mixed, required: true },
    by: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    at: { type: Date, required: true },
    metadata: {
      source_type: { type: String, enum: ['report_section_version'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: [...COPE_DIMENSIONS, 'all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  // Mixed keeps `document` exactly as validated, empty arrays included.
  { collection: 'report_section_versions', minimize: false },
)

// One version per number, and the newest of each section read first.
reportSectionVersionSchema.index({ assessment: 1, sectionId: 1, version: -1 }, { unique: true })

// Versions are only ever added: saving an existing one, and every update,
// replace or delete through the model, is refused.
function refuse(): never {
  throw new ImmutableVersionError()
}
reportSectionVersionSchema.pre('save', function () {
  if (!this.isNew) refuse()
})
for (const method of ['updateOne', 'deleteOne'] as const) {
  reportSectionVersionSchema.pre(method, { document: true, query: true }, refuse)
}
for (const method of [
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  reportSectionVersionSchema.pre(method, refuse)
}

export const ReportSectionVersionModel = model<IReportSectionVersion>(
  'ReportSectionVersion',
  reportSectionVersionSchema,
)
