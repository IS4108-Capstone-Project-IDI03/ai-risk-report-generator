import { Schema, Types, model } from 'mongoose'
import { COPE_DIMENSIONS, type CopeDimension } from './observation.model'

// Comment threads on the report (RV-03), as in Google Docs: a thread is
// anchored to a passage of one section's text in the document editor, and
// holds its comments, oldest first. Anyone who can open the assessment (its
// assigned engineer, or a knowledge admin) comments, replies, resolves and
// reopens; each comment is changed or deleted only by its author.
//
// Threads are kept apart from the report's text: a comment never adds a
// version to `report_section_versions` (RV-08), so a knowledge admin, who
// cannot change the text, still comments, and the export (EX-01) never sees
// one. The anchor says where the thread is in the section's text, as the
// document editor reads it: each text block it saves (paragraphs,
// sub-headings, list items), in order, joined by a line break, with a citation
// marker as U+FFFC. Its quote and the text either side find it again when
// the section changes outside the editor (a finding edited or rejected in
// review, a redraft, a restore); the editor moves it with each edit and saves
// where it now is. Written by comment.service; see docs/areas/database.md.

export const THREAD_STATUSES = ['open', 'resolved'] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]

// Where in a section a thread is. `start` and `end` are offsets into the
// section's text (above); `exact` is the text between them, `prefix` and
// `suffix` up to 32 characters either side.
export interface ICommentAnchor {
  // '1' to '12', or 'A' for Appendix A.
  sectionId: string
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

export type Stamp = { id: string; name: string }

export interface IReportComment {
  _id: Types.ObjectId
  // Plain text.
  body: string
  by: Stamp
  at: Date
  // Set when its author edits it (AC3), shown as "Edited".
  editedAt: Date | null
  // Set when its author deletes the thread's first comment while others
  // reply to it: its words are gone and it reads "Comment deleted". Any other
  // deleted comment is removed from the thread.
  deletedAt: Date | null
}

export interface IReportCommentThread {
  assessment: Types.ObjectId
  anchor: ICommentAnchor
  // True once the text it was on was deleted entirely (AC6): it stays in the
  // comments list, quoting `anchor.exact`, and is no longer in the margin.
  detached: boolean
  status: ThreadStatus
  // Who resolved it, while it is resolved.
  resolved: { by: Stamp; at: Date } | null
  comments: IReportComment[]
  createdBy: Stamp
  createdAt: Date
  updatedAt: Date
  // Required on every document (see CLAUDE.md), from the site and the
  // section: COPE_dimension is the section draft's, or 'all' for a section
  // without one (1, 2, 3 and A, or one not drafted yet). effective_date is
  // when the thread was started.
  metadata: {
    source_type: 'report_comment_thread'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | 'all'
    effective_date: Date
  }
}

export const SECTION_ID = /^(1[0-2]|[1-9]|A)$/

const stamp = {
  id: { type: String, required: true },
  name: { type: String, required: true },
}

const commentSchema = new Schema<IReportComment>(
  {
    body: { type: String, default: '' },
    by: { type: new Schema(stamp, { _id: false }), required: true },
    at: { type: Date, required: true },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { _id: true },
)

const reportCommentThreadSchema = new Schema<IReportCommentThread>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    anchor: {
      sectionId: { type: String, required: true, match: SECTION_ID },
      start: { type: Number, required: true, min: 0 },
      end: { type: Number, required: true, min: 1 },
      exact: { type: String, required: true },
      prefix: { type: String, default: '' },
      suffix: { type: String, default: '' },
    },
    detached: { type: Boolean, default: false },
    status: { type: String, enum: THREAD_STATUSES, default: 'open' },
    resolved: {
      type: new Schema({ by: new Schema(stamp, { _id: false }), at: Date }, { _id: false }),
      default: null,
    },
    comments: { type: [commentSchema], default: [] },
    createdBy: { type: new Schema(stamp, { _id: false }), required: true },
    metadata: {
      source_type: { type: String, enum: ['report_comment_thread'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: [...COPE_DIMENSIONS, 'all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  // The empty prefix and suffix of a thread at a section's very start or end
  // are kept as they are.
  { timestamps: true, collection: 'report_comment_threads', minimize: false },
)

// An assessment's threads, oldest first; and its open ones, counted for the
// export's reminder (EX-01).
reportCommentThreadSchema.index({ assessment: 1, createdAt: 1 })
reportCommentThreadSchema.index({ assessment: 1, status: 1 })

export const ReportCommentThreadModel = model<IReportCommentThread>(
  'ReportCommentThread',
  reportCommentThreadSchema,
)
