import { Schema, Types, model } from 'mongoose'
import { SECTION_ID, type ICommentAnchor } from './report-comment.model'

// Questions asked about an assessment in the review workspace's Ask tab, each
// with its answer (AS-01). One document per question: the engineer's own
// conversation about that assessment, read back when the tab opens again.
// A question can be about a passage selected in the draft (AS-02): it then
// keeps where that passage is, as a comment thread's anchor (RV-03), so the
// tab links back to it, or says "Text deleted" once it is gone.
// Each holds the trace of the run that answered it (retrieve, assemble,
// generate, guardrail), so the evaluation harness can score answers later.
// See docs/areas/database.md, "Assessment questions".

// `answering` from when the question is saved until its answer ends;
// `complete` once it ended; `stopped` when it was cut off part-way (the
// engineer left, or the model or search failed after some of it was shown);
// `failed` when nothing could be answered.
export const QUESTION_STATUSES = ['answering', 'complete', 'stopped', 'failed'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

// One source a statement cites: `O:<observation id>`, `C:<chunk id>` for a
// standard's passage or `P:<chunk id>` for a past report's, with the words it
// quotes and whether they were found in the source.
export interface IAnswerCitation {
  ref: string
  kind: 'observation' | 'standard' | 'report'
  quote: string | null
  verified: boolean
}

export interface IAnswerStatement {
  text: string
  citations: IAnswerCitation[]
  // Set on a line naming where the sources behind a selected passage disagree
  // (AS-02 AC4): each figure with its source, never choosing between them.
  differs?: boolean
}

// The passage a question was asked about (AS-02): its anchor in the section's
// text, in RV-03's format; the section as the report heads it; the sources it
// cites (O:/C:/P: refs) and the keys of the section's findings it is in. Never
// moved as the text changes: the tab finds it again from its words.
export interface IQuestionPassage {
  anchor: ICommentAnchor
  label: string
  citations: string[]
  findings: string[]
}

export interface IAssessmentQuestion {
  assessment: Types.ObjectId
  // Who asked: only they read it back.
  userId: Types.ObjectId
  question: string
  // The passage it is about, or null for a question about the whole assessment.
  passage: IQuestionPassage | null
  status: QuestionStatus
  statements: IAnswerStatement[]
  // What evidence the answer says is missing (AC4).
  missing: string[]
  // The cited sources as S4 returned them, by citation ID: a passage's text and
  // Chroma labels, or an observation as it was sent. Read with the documents'
  // details now, as the review workspace reads a draft's sources.
  sources: Record<string, unknown>
  // Worked out from the answer's checks, never asked of the model (AC5); null
  // when nothing was answered.
  confidence: ConfidenceLevel | null
  // Why the answer stopped, at which step and when (AC8); null if it did not.
  error: { step: string; cause: string; at: Date } | null
  // The run's trace (AC6): pipeline steps, provider, model, prompt version,
  // what was searched and retrieved, the guardrail's results, timings and
  // whether client details were masked. Never the masked text or the mapping.
  trace: Record<string, unknown> | null
  // Required on every document (see CLAUDE.md). A question covers the whole
  // assessment, so COPE_dimension is 'all'.
  metadata: {
    source_type: 'assessment_question'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const citationSchema = new Schema<IAnswerCitation>(
  {
    ref: { type: String, required: true },
    kind: { type: String, enum: ['observation', 'standard', 'report'], required: true },
    quote: { type: String, default: null },
    verified: { type: Boolean, required: true },
  },
  { _id: false },
)

const passageSchema = new Schema<IQuestionPassage>(
  {
    anchor: {
      type: new Schema<ICommentAnchor>(
        {
          sectionId: { type: String, required: true, match: SECTION_ID },
          start: { type: Number, required: true, min: 0 },
          end: { type: Number, required: true, min: 1 },
          exact: { type: String, required: true },
          prefix: { type: String, default: '' },
          suffix: { type: String, default: '' },
        },
        { _id: false },
      ),
      required: true,
    },
    label: { type: String, required: true },
    citations: { type: [String], default: [] },
    findings: { type: [String], default: [] },
  },
  { _id: false },
)

const assessmentQuestionSchema = new Schema<IAssessmentQuestion>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    question: { type: String, required: true, maxlength: 1000 },
    passage: { type: passageSchema, default: null },
    status: { type: String, enum: QUESTION_STATUSES, default: 'answering' },
    statements: {
      type: [
        new Schema<IAnswerStatement>(
          {
            text: { type: String, required: true },
            citations: [citationSchema],
            differs: { type: Boolean },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    missing: { type: [String], default: [] },
    sources: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: String, enum: [...CONFIDENCE_LEVELS, null], default: null },
    error: {
      type: new Schema(
        {
          step: String,
          cause: { type: String, required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    trace: { type: Schema.Types.Mixed, default: null },
    metadata: {
      source_type: { type: String, enum: ['assessment_question'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'assessment_questions', minimize: false },
)

// One user's questions on one assessment, oldest first.
assessmentQuestionSchema.index({ assessment: 1, userId: 1, createdAt: 1 })

export const AssessmentQuestionModel = model<IAssessmentQuestion>(
  'AssessmentQuestion',
  assessmentQuestionSchema,
)

export type AssessmentQuestionDocument = IAssessmentQuestion & { _id: Types.ObjectId }
