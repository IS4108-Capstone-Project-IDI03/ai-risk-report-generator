import { Schema, Types, model } from 'mongoose'
import type { IAnswerCitation } from './assistant-conversation.model'
import { COPE_DIMENSIONS, type CopeDimension, type IStamp } from './observation.model'
import type { SectionDocument } from './report-section-version.model'

// Text drafted or rewritten for one of a report's Sections 4 to 12 from the
// Ask tab (AS-04): one document per proposal. The engineer asks for it ("Draft
// text", or "Rewrite this" on a selection), reads it in the Ask tab with each
// sentence cited or marked unsupported, and Inserts or Replaces it into the
// section: the section then saves a new version (report_section_versions)
// whose new paragraphs carry `ai: <this _id>` until the engineer accepts
// them. The section is never written when the proposal is made.
//
// A proposal is asked for in a conversation (assistant_conversations), whose
// turn points here, but it belongs to the report once inserted: the review
// workspace reads the passages and observations an inserted proposal cites
// from here, never from the conversation, so deleting a conversation leaves
// inserted text with its sources. Only its asker reads and inserts it.
// Written by services/text-proposal.service.ts. See docs/areas/database.md,
// "Proposed text".

export const PROPOSAL_KINDS = ['draft', 'rewrite'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

// `drafting` while the model writes it; `proposed` once written with some text;
// `failed` with none; `inserted` once Insert or Replace put it in the section;
// then `accepted` (kept as the engineer's), `deleted` (taken out again) or
// `undone` (the section's text before it restored). Whether inserted text still
// awaits Accept is read from the section's text, not from here: a version
// restored from the history can bring it back.
export const PROPOSAL_STATUSES = [
  'drafting',
  'proposed',
  'failed',
  'inserted',
  'accepted',
  'deleted',
  'undone',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

// One sentence as proposed: its words, the citations that count (an
// observation, or a standard in the drafting set with its quote found), and
// whether it has any. `paragraph` numbers the paragraph it is in, from 0.
export interface IProposedSentence {
  text: string
  citations: IAnswerCitation[]
  supported: boolean
  paragraph: number
}

// The paragraphs a rewrite replaces, as the section's text stood when it was
// proposed: from text block `from` to `to` (in the order the document editor
// saves them), their words, and the sources they cite.
export interface IReplacedText {
  from: number
  to: number
  words: string
  citations: string[]
}

export interface IReportTextProposal {
  assessment: Types.ObjectId
  // '4' to '12', and the section as the report heads it, e.g. "10. Exposures".
  sectionId: string
  label: string
  kind: ProposalKind
  // Who asked, in which conversation and turn; only they see and insert it.
  userId: Types.ObjectId
  conversation: Types.ObjectId | null
  turn: Types.ObjectId | null
  // What the engineer asked for, e.g. "Draft a paragraph on flood exposure".
  request: string
  // A draft: the subsections it can go at the end of, by index and heading
  // (none for a section with no draft, whose text has no subsections), and
  // the one it goes in (-1: the text before the first), as the model
  // suggested it or the engineer chose on Insert; null until known.
  choices: { index: number; heading: string }[]
  subsection: number | null
  // A rewrite: what it replaces.
  replaces: IReplacedText | null
  // The section when it was proposed (AC6): its newest version (0 for none),
  // its saved draft, and its text's signature. Insert refuses once any differs.
  base: { version: number; draft: Types.ObjectId | null; signature: string }
  status: ProposalStatus
  sentences: IProposedSentence[]
  // What evidence the model said was missing, not part of the text.
  missing: string[]
  // The cited sources as S4 returned them, by citation ID: a standard
  // passage's text and Chroma labels, or an observation as it was sent.
  sources: Record<string, unknown>
  // What wrote it, from S4's trace; null until written.
  provider: string | null
  model: string | null
  promptVersion: string | null
  // Insert or Replace: the version it made, the section's text just before
  // (what Undo restores), and who and when; null until inserted.
  insertion: {
    version: number
    previous: SectionDocument
    // The section's text as the insert left it: Undo refuses once it differs.
    signature: string
    at: Date
    by: IStamp['by']
  } | null
  // The last of Accept, Delete or Undo on it; null before.
  settled: { action: 'accepted' | 'deleted' | 'undone'; at: Date; by: IStamp['by'] } | null
  // Required on every document (see CLAUDE.md): from the site, the section's
  // one category or 'all', and when it was proposed.
  metadata: {
    source_type: 'report_text_proposal'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension | 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const stampSchema = new Schema(
  { id: { type: String, required: true }, name: { type: String, required: true } },
  { _id: false },
)

const reportTextProposalSchema = new Schema<IReportTextProposal>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    sectionId: { type: String, required: true, match: /^(1[0-2]|[4-9])$/ },
    label: { type: String, required: true },
    kind: { type: String, enum: PROPOSAL_KINDS, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversation: { type: Schema.Types.ObjectId, default: null },
    turn: { type: Schema.Types.ObjectId, default: null },
    request: { type: String, required: true, maxlength: 1000 },
    choices: {
      type: [
        new Schema(
          { index: { type: Number, required: true }, heading: { type: String, required: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
    subsection: { type: Number, default: null, min: -1 },
    replaces: {
      type: new Schema<IReplacedText>(
        {
          from: { type: Number, required: true, min: 0 },
          to: { type: Number, required: true, min: 0 },
          words: { type: String, required: true },
          citations: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: null,
    },
    base: {
      type: new Schema(
        {
          version: { type: Number, required: true, min: 0 },
          draft: { type: Schema.Types.ObjectId, default: null },
          signature: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'drafting' },
    sentences: {
      type: [
        new Schema<IProposedSentence>(
          {
            text: { type: String, required: true },
            citations: { type: [Schema.Types.Mixed], default: [] },
            supported: { type: Boolean, required: true },
            paragraph: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    missing: { type: [String], default: [] },
    sources: { type: Schema.Types.Mixed, default: {} },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    promptVersion: { type: String, default: null },
    insertion: {
      type: new Schema(
        {
          version: { type: Number, required: true, min: 1 },
          // Mixed keeps the text exactly as it was, empty arrays included.
          previous: { type: Schema.Types.Mixed, required: true },
          signature: { type: String, required: true },
          at: { type: Date, required: true },
          by: { type: stampSchema, required: true },
        },
        { _id: false, minimize: false },
      ),
      default: null,
    },
    settled: {
      type: new Schema(
        {
          action: { type: String, enum: ['accepted', 'deleted', 'undone'], required: true },
          at: { type: Date, required: true },
          by: { type: stampSchema, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    metadata: {
      source_type: { type: String, enum: ['report_text_proposal'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: [...COPE_DIMENSIONS, 'all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { collection: 'report_text_proposals', timestamps: true, minimize: false },
)

// A user's proposals on an assessment, and every inserted one the review
// workspace reads for an assessment's sections.
reportTextProposalSchema.index({ assessment: 1, userId: 1 })
reportTextProposalSchema.index({ assessment: 1, sectionId: 1, 'insertion.at': 1 })

export const ReportTextProposalModel = model<IReportTextProposal>(
  'ReportTextProposal',
  reportTextProposalSchema,
)
