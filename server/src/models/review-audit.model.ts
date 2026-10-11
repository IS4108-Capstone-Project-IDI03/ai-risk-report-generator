import { Schema, Types, model } from 'mongoose'
import { COPE_DIMENSIONS, type CopeDimension, type IStamp } from './observation.model'

// The immutable audit log of review decisions (RV-02): one entry per decision
// an engineer makes on a report section's draft. A finding (one statement of
// a draft) is accepted, edited, rejected or restored; a whole draft is a
// replacement asked for by Regenerate, then accepted or discarded.
//
// Drafts in `report_sections` are never changed. A finding's review state and
// current text are read from this log (see review-decision.service), so the
// review summary is counted from the saved decisions themselves (AC9).
//
// Entries are only ever added. The model refuses every update and delete, so
// the text before and after an edit (AC3), who made each decision and when
// (AC4), and a rejected finding's content (AC6) stay as recorded. The raw
// driver can still write the collection; only the dev seeds do, to reset
// sample data. Written by review-decision.service; see docs/areas/database.md.
export const REVIEW_ACTIONS = [
  'accept',
  'edit',
  'reject',
  'restore',
  'regenerate',
  'accept_replacement',
  'discard_replacement',
] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

export interface IReviewAuditEntry {
  assessment: Types.ObjectId
  // The template's section number, '7' to '12'.
  sectionId: string
  // The report_sections draft the decision is about: the one whose finding
  // was decided, or the replacement draft that was asked for, accepted or
  // discarded.
  draft: Types.ObjectId
  // The finding as `<subsection index>.<statement index>` in the draft, e.g.
  // '0.2'. A draft's statements are never reordered or removed, so the key
  // stays put. null for a decision on the whole draft.
  finding: string | null
  // 0, 1, 2… for each draft and finding, in the order decided. Unique with
  // them, so of two decisions made at once on one finding only one is saved.
  sequence: number
  action: ReviewAction
  // The finding's subsection heading, to read the entry on its own.
  heading: string | null
  // The finding's text before the decision: what was accepted, edited or
  // rejected (AC3, AC6).
  before: string | null
  // The engineer's text, for an edit (AC3).
  after: string | null
  // The finding's citations when it was decided, kept with its content (AC6).
  citations: string[]
  // What the engineer asked a regenerated draft to change, if anything.
  instruction: string | null
  // Accepted by Bulk accept (AC7) rather than one at a time.
  bulk: boolean
  // The signed-in user who decided, as they were then, and when (AC4).
  by: IStamp['by']
  at: Date
  // Required on every document (see CLAUDE.md), from the draft's site and
  // section, so decisions can be counted by section, country or facility
  // type (EV-02). effective_date is when the decision was made.
  metadata: {
    source_type: 'review_decision'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | 'all'
    effective_date: Date
  }
}

export class AppendOnlyError extends Error {
  constructor() {
    super('The review audit log is append-only: its entries cannot be changed or deleted.')
    this.name = 'AppendOnlyError'
  }
}

const reviewAuditSchema = new Schema<IReviewAuditEntry>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    sectionId: { type: String, required: true },
    draft: { type: Schema.Types.ObjectId, ref: 'ReportSection', required: true },
    finding: { type: String, default: null, match: /^\d+\.\d+$/ },
    sequence: { type: Number, required: true, min: 0 },
    action: { type: String, enum: REVIEW_ACTIONS, required: true },
    heading: { type: String, default: null },
    before: { type: String, default: null },
    after: { type: String, default: null },
    citations: { type: [String], default: [] },
    instruction: { type: String, default: null },
    bulk: { type: Boolean, default: false },
    by: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    at: { type: Date, required: true },
    metadata: {
      source_type: { type: String, enum: ['review_decision'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: [...COPE_DIMENSIONS, 'all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { collection: 'review_audit_log' },
)

// One decision per place in a finding's sequence (see `sequence`).
reviewAuditSchema.index({ draft: 1, finding: 1, sequence: 1 }, { unique: true })
// A section's history, newest first.
reviewAuditSchema.index({ assessment: 1, sectionId: 1, at: -1 })

// Append-only: saving an existing entry, and every update, replace or delete
// through the model, is refused.
function refuse(): never {
  throw new AppendOnlyError()
}
reviewAuditSchema.pre('save', function () {
  if (!this.isNew) refuse()
})
for (const method of ['updateOne', 'deleteOne'] as const) {
  reviewAuditSchema.pre(method, { document: true, query: true }, refuse)
}
for (const method of [
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  reviewAuditSchema.pre(method, refuse)
}

export const ReviewAuditModel = model<IReviewAuditEntry>('ReviewAudit', reviewAuditSchema)
