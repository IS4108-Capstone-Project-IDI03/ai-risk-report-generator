import { Schema, Types, model } from 'mongoose'
import { CONFIDENCE_LEVELS, type ConfidenceLevel } from './assistant-conversation.model'
import type { CopeDimension, Severity } from './observation.model'

// Comparing an assessment with the previous report for the same site (RV-13):
// one document per run of Compare with previous report, a finished one or a
// failed one. The previous report's items and the current evidence are kept as
// they were compared, so the comparison still reads right after either changes.
// The engineer's decisions are appended to `decisions` and never changed; an
// item's outcome is the comparison's, until the engineer decides it.
// Nothing here is part of the report: no section, version, review log entry or
// finding is written, and the export never reads this collection. Written by
// report-comparison.service; see docs/areas/database.md, "Report comparisons".

// What became of a previous report item: the model suggests one of these, and
// the gateway's rules (report-comparison-rules.ts) may change it.
export const COMPARISON_OUTCOMES = [
  'fixed',
  'improved',
  'unchanged',
  'worse',
  'not_checked',
] as const
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number]
// A current finding with no counterpart in the previous report is New.
export type ItemOutcome = ComparisonOutcome | 'new'

// One finding or recommendation of the previous report, in report order. `quote`
// is its words as the report reads them, never the model's.
export interface IPreviousItem {
  // 'P:<section>:<finding>' for a drafted finding, 'P:<section>:b<n>' for text
  // the engineer wrote (its block in the section), 'P:3:<OFI id>' for an OFI.
  key: string
  // How the model was given it: P1, P2, …
  label: string
  kind: 'finding' | 'recommendation'
  sectionId: string
  // As the report heads it: "9. Fire Protection".
  section: string
  // Its subsection, or an OFI's number and title.
  heading: string | null
  quote: string
  // An OFI's Observation column, also quoted as the report reads it.
  context: string | null
  // The highest severity of the observations it cites, or null for none.
  severity: Severity | null
  // An OFI's priority, e.g. "Priority 2".
  priority: string | null
  categories: CopeDimension[]
  location: string | null
}

// One piece of the current assessment's evidence the comparison was given: an
// observation, a draft finding (Sections 4 to 12) or an accepted OFI (Section 3).
export interface ICurrentSource {
  // 'O:<observation id>', 'F:<section>:<draft id>:<finding>' or 'R:<OFI id>'.
  key: string
  label: string
  kind: 'observation' | 'finding' | 'recommendation'
  sectionId: string | null
  section: string
  // An observation's location, a finding's subsection, an OFI's title.
  title: string | null
  text: string
  // Only an engineer's value: a suggested severity not yet confirmed is null.
  severity: Severity | null
  priority: string | null
  categories: CopeDimension[]
  location: string | null
  // The observation it is, or those a finding or OFI cites.
  observations: string[]
  // A finding's `<subsection>.<statement>`.
  finding: string | null
  // What it said and how it was tagged when compared: either differing now
  // means the comparison is out of date.
  textHash: string
  tagHash: string
}

// A figure written in both reports, both values exactly as written. The
// difference is worked out in code (report-comparison-rules.ts), never by the model.
export interface IComparisonFigure {
  name: string
  previous: string
  current: string
  // The current source it is written in, by key.
  source: string
  difference: string | null
  // Why there is no difference, e.g. the units differ.
  note: string | null
}

// The comparison's outcome for one previous item, after the gateway's rules.
export interface IComparisonItem {
  key: string
  // null while current sources disagree: the engineer decides (AC "Sources disagree").
  outcome: ComparisonOutcome | null
  // What the model suggested, before the rules.
  suggested: ComparisonOutcome
  // Current sources by key.
  sources: string[]
  disagree: string[]
  possible: string[]
  reason: string | null
  missing: string | null
  confidence: ConfidenceLevel
  figures: IComparisonFigure[]
  // What the rules changed: 'no_source', 'severity', 'omitted', 'figure'.
  corrections: string[]
}

export const DECISION_ACTIONS = [
  'accept',
  'outcome',
  'pair',
  'unpair',
  'dismiss',
  'restore',
] as const
export type DecisionAction = (typeof DECISION_ACTIONS)[number]

// One decision by the engineer. It records the item's whole state after it, so
// the latest decision on an item is what it now reads.
export interface IComparisonDecision {
  // A previous item's key, or 'N:<source key>' for a New one.
  item: string
  action: DecisionAction
  outcome: ItemOutcome | null
  sources: string[]
  note: string | null
  dismissed: boolean
  // Copied from an earlier comparison by Compare again, with its own by and at.
  carriedFrom: Types.ObjectId | null
  by: { id: string; name: string }
  at: Date
}

export interface IReportComparison {
  assessment: Types.ObjectId
  // The earlier finalised report it compares with.
  previous: {
    assessment: Types.ObjectId
    reference: string
    siteVisitDate: Date | null
    engineer: { id: string; name: string } | null
  }
  status: 'done' | 'failed'
  // A failed run's reason, shown with its time.
  error: string | null
  previousItems: IPreviousItem[]
  sources: ICurrentSource[]
  items: IComparisonItem[]
  // Items Compare again flagged for another look, and why.
  recheck: { item: string; reason: string }[]
  decisions: IComparisonDecision[]
  // How many things in the model's answer were left out by S4's checks.
  dropped: number
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    rules_version: string
    generated_at: Date
    privacy: { enabled: boolean; masked_count: number }
  } | null
  createdBy: { id: string; name: string }
  // Required on every document (see CLAUDE.md). A comparison covers the whole
  // report, so COPE_dimension is 'all', as a drafting run's is.
  metadata: {
    source_type: 'report_comparison'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const stamp = {
  id: { type: String, required: true },
  name: { type: String, required: true },
}
const strings = { type: [String], default: [] }

const comparisonSchema = new Schema<IReportComparison>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    previous: {
      assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
      reference: { type: String, required: true },
      siteVisitDate: { type: Date, default: null },
      engineer: { type: new Schema(stamp, { _id: false }), default: null },
    },
    status: { type: String, enum: ['done', 'failed'], required: true },
    error: { type: String, default: null },
    previousItems: [
      {
        _id: false,
        key: { type: String, required: true },
        label: { type: String, required: true },
        kind: { type: String, enum: ['finding', 'recommendation'], required: true },
        sectionId: { type: String, required: true },
        section: { type: String, required: true },
        heading: { type: String, default: null },
        quote: { type: String, required: true },
        context: { type: String, default: null },
        severity: { type: String, default: null },
        priority: { type: String, default: null },
        categories: strings,
        location: { type: String, default: null },
      },
    ],
    sources: [
      {
        _id: false,
        key: { type: String, required: true },
        label: { type: String, required: true },
        kind: { type: String, enum: ['observation', 'finding', 'recommendation'], required: true },
        sectionId: { type: String, default: null },
        section: { type: String, required: true },
        title: { type: String, default: null },
        text: { type: String, required: true },
        severity: { type: String, default: null },
        priority: { type: String, default: null },
        categories: strings,
        location: { type: String, default: null },
        observations: strings,
        finding: { type: String, default: null },
        textHash: { type: String, required: true },
        tagHash: { type: String, required: true },
      },
    ],
    items: [
      {
        _id: false,
        key: { type: String, required: true },
        outcome: { type: String, enum: [...COMPARISON_OUTCOMES, null], default: null },
        suggested: { type: String, enum: COMPARISON_OUTCOMES, required: true },
        sources: strings,
        disagree: strings,
        possible: strings,
        reason: { type: String, default: null },
        missing: { type: String, default: null },
        confidence: { type: String, enum: CONFIDENCE_LEVELS, required: true },
        figures: [
          {
            _id: false,
            name: { type: String, required: true },
            previous: { type: String, required: true },
            current: { type: String, required: true },
            source: { type: String, required: true },
            difference: { type: String, default: null },
            note: { type: String, default: null },
          },
        ],
        corrections: strings,
      },
    ],
    recheck: [
      {
        _id: false,
        item: { type: String, required: true },
        reason: { type: String, required: true },
      },
    ],
    decisions: [
      {
        _id: false,
        item: { type: String, required: true },
        action: { type: String, enum: DECISION_ACTIONS, required: true },
        outcome: { type: String, enum: [...COMPARISON_OUTCOMES, 'new', null], default: null },
        sources: strings,
        note: { type: String, default: null },
        dismissed: { type: Boolean, required: true },
        carriedFrom: { type: Schema.Types.ObjectId, default: null },
        by: stamp,
        at: { type: Date, required: true },
      },
    ],
    dropped: { type: Number, default: 0 },
    provenance: {
      type: new Schema(
        {
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
        { _id: false },
      ),
      default: null,
    },
    createdBy: stamp,
    metadata: {
      source_type: { type: String, enum: ['report_comparison'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'report_comparisons' },
)

// The tab reads an assessment's latest run against one previous report.
comparisonSchema.index({ assessment: 1, 'previous.reference': 1, createdAt: -1 })

export const ReportComparisonModel = model<IReportComparison>('ReportComparison', comparisonSchema)
