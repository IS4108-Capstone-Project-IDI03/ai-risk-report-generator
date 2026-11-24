import { Schema, Types, model } from 'mongoose'
import { SECTION_ID, type ICommentAnchor } from './report-comment.model'

// The Ask tab's conversations (AS-03): one engineer's questions about one
// assessment and their answers (AS-01), each perhaps about a passage selected
// in the draft (AS-02), in the order asked. One document per conversation,
// holding its questions as `turns`, so the tab reopens on the latest one and
// the engineer can pick up where they left off.
// Private to its user: every read and write is scoped to `userId` and the
// assessment, so another user's conversation looks like it does not exist
// (knowledge admins included). On an archived assessment it is only read.
// Never part of the report (AC4): the export reads none of it, and asking or
// deleting adds no version and changes no review state.
// Each answer keeps the sources it cited, the provider, model and prompt
// version that wrote it, when it was asked and answered, and the run's trace,
// so the evaluation harness can replay and score it (AC3).
// A turn can be writing guidance for a section (AS-08): what it should cover,
// answered by S4 from the template's definition of it and the selected
// standards; or what is missing from it, listed by the gateway with no AI call
// (`gaps`).
// Written by services/assessment-ask.service.ts. See docs/areas/database.md,
// "Ask conversations".

// The most questions one conversation holds (AC2); the engineer then starts a
// new one. Keeps a conversation, with its sources and traces, well inside
// MongoDB's 16 MB document limit.
export const MAX_CONVERSATION_QUESTIONS = 100

// `answering` from when the question is saved until its answer ends;
// `complete` once it ended; `stopped` when it was cut off part-way (the
// engineer left, or the model or search failed after some of it was shown);
// `failed` when nothing could be answered.
export const QUESTION_STATUSES = ['answering', 'complete', 'stopped', 'failed'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

// One source a statement cites: `O:<observation id>`, `C:<chunk id>` for a
// standard's passage or `P:<chunk id>` for a past report's, or `T:<section>` /
// `T:<section>.<part>` for the report template's definition of a section or
// one of its parts (AS-08), with the words it quotes and whether they were
// found in the source.
export const CITATION_KINDS = ['observation', 'standard', 'report', 'template'] as const
export interface IAnswerCitation {
  ref: string
  kind: (typeof CITATION_KINDS)[number]
  quote: string | null
  verified: boolean
  // The words are only in a picture's AI description (KB-02): cited, never
  // found in the document. Absent on older answers, meaning false.
  described?: boolean
}

export interface IAnswerStatement {
  text: string
  citations: IAnswerCitation[]
  // Set on a line naming where the sources behind a selected passage disagree
  // (AS-02 AC4): each figure with its source, never choosing between them.
  differs?: boolean
  // A sentence of text proposed for a section (AS-04): whether a source
  // supports it (false: kept, marked unsupported) and its paragraph, from 0.
  supported?: boolean
  paragraph?: number
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

// Writing guidance asked for one section (AS-08): what it should cover, or
// what is missing from it; the section, and how the report heads it.
export const GUIDANCE_KINDS = ['cover', 'missing'] as const
export type GuidanceKind = (typeof GUIDANCE_KINDS)[number]
export interface IQuestionGuidance {
  kind: GuidanceKind
  sectionId: string
  label: string
}

// One thing missing from a section (AS-08 AC2), stated as a fact (AC4), with
// where it is finished: the section (at a subsection or finding when known),
// or an observation (the Observations tab when `observationId` is null). Those
// that block the export are the export check's own (AC3).
export const GAP_KINDS = [
  'not_drafted',
  'out_of_date',
  'no_ofis',
  'figures',
  'not_written',
  'ai_unsupported',
  'ai_pending',
  'replacement',
  'pending_findings',
  'unsupported_findings',
  'withdrawn_sources',
  'no_text',
  'table',
  'category',
  'observation',
] as const
export type GapKind = (typeof GAP_KINDS)[number]
export type GapLink =
  | { to: 'section'; sectionId: string; subsection?: number; finding?: string }
  | { to: 'observation'; observationId: string | null }
export interface ISectionGap {
  kind: GapKind
  fact: string
  blocksExport: boolean
  link: GapLink
}

// One question and its answer.
export interface IConversationTurn {
  _id: Types.ObjectId
  question: string
  // The passage it is about, or null for a question about the whole assessment.
  passage: IQuestionPassage | null
  // A request for text for a section (AS-04), "Draft text" or "Rewrite this":
  // its proposal in report_text_proposals. Absent or null for a question.
  proposal?: Types.ObjectId | null
  // Writing guidance for a section (AS-08); absent or null for a question.
  guidance?: IQuestionGuidance | null
  // What is missing from the section (AS-08 AC2), in that order: those that
  // block the export first. Absent or empty for anything else.
  gaps?: ISectionGap[]
  status: QuestionStatus
  statements: IAnswerStatement[]
  // What evidence the answer says is missing (AS-01 AC4).
  missing: string[]
  // The cited sources as S4 returned them, by citation ID (AC3): a passage's
  // text and Chroma labels, or an observation as it was sent. Read with the
  // documents' details now, as the review workspace reads a draft's sources.
  sources: Record<string, unknown>
  // Worked out from the answer's checks, never asked of the model; null when
  // nothing was answered.
  confidence: ConfidenceLevel | null
  // Why the answer stopped, at which step and when; null if it did not.
  error: { step: string; cause: string; at: Date } | null
  // What wrote the answer (AC3), as S4's trace names it: the provider from
  // LLM_PROVIDER, the model and the prompt version. Null until the answer ends,
  // or when S4 never said (it could not be reached).
  provider: string | null
  model: string | null
  promptVersion: string | null
  // When it was asked, and when its answer ended (null while answering).
  askedAt: Date
  answeredAt: Date | null
  // The run's trace (AS-01 AC6): pipeline steps, provider, model, prompt
  // version, what was searched and retrieved, the guardrail's results, timings
  // and whether client details were masked. Never the masked text or the mapping.
  trace: Record<string, unknown> | null
}

export interface IAssistantConversation {
  assessment: Types.ObjectId
  // Who asked: only they read it, and only they can delete it.
  userId: Types.ObjectId
  // The first question, trimmed to 60 characters (no AI call).
  title: string
  // When its last question was asked: the Ask tab opens on the latest (AC2).
  lastAskedAt: Date
  // Its questions, oldest first; at most MAX_CONVERSATION_QUESTIONS.
  turns: IConversationTurn[]
  // Required on every document (see CLAUDE.md). A conversation covers the
  // whole assessment, so COPE_dimension is 'all'; effective_date is when it
  // was started.
  metadata: {
    source_type: 'assistant_conversation'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

// Also a proposed sentence's citations (AS-04, report-text-proposal.model.ts).
export const citationSchema = new Schema<IAnswerCitation>(
  {
    ref: { type: String, required: true },
    kind: { type: String, enum: CITATION_KINDS, required: true },
    quote: { type: String, default: null },
    verified: { type: Boolean, required: true },
    described: { type: Boolean },
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

const guidanceSchema = new Schema<IQuestionGuidance>(
  {
    kind: { type: String, enum: GUIDANCE_KINDS, required: true },
    sectionId: { type: String, required: true, match: SECTION_ID },
    label: { type: String, required: true },
  },
  { _id: false },
)

// A gap's link is kept as given: a section's or an observation's (see GapLink).
const gapSchema = new Schema<ISectionGap>(
  {
    kind: { type: String, enum: GAP_KINDS, required: true },
    fact: { type: String, required: true },
    blocksExport: { type: Boolean, required: true },
    link: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
)

const turnSchema = new Schema<IConversationTurn>(
  {
    question: { type: String, required: true, maxlength: 1000 },
    passage: { type: passageSchema, default: null },
    proposal: { type: Schema.Types.ObjectId, default: null },
    guidance: { type: guidanceSchema, default: null },
    gaps: { type: [gapSchema], default: undefined },
    status: { type: String, enum: QUESTION_STATUSES, default: 'answering' },
    statements: {
      type: [
        new Schema<IAnswerStatement>(
          {
            text: { type: String, required: true },
            citations: [citationSchema],
            differs: { type: Boolean },
            supported: { type: Boolean },
            paragraph: { type: Number },
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
    provider: { type: String, default: null },
    model: { type: String, default: null },
    promptVersion: { type: String, default: null },
    askedAt: { type: Date, required: true },
    answeredAt: { type: Date, default: null },
    trace: { type: Schema.Types.Mixed, default: null },
  },
  { minimize: false },
)

const assistantConversationSchema = new Schema<IAssistantConversation>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    lastAskedAt: { type: Date, required: true },
    turns: { type: [turnSchema], default: [] },
    metadata: {
      source_type: { type: String, enum: ['assistant_conversation'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'assistant_conversations', minimize: false },
)

// One user's conversations on one assessment, latest first.
assistantConversationSchema.index({ assessment: 1, userId: 1, lastAskedAt: -1 })

export const AssistantConversationModel = model<IAssistantConversation>(
  'AssistantConversation',
  assistantConversationSchema,
)

export type AssistantConversationDocument = IAssistantConversation & { _id: Types.ObjectId }
