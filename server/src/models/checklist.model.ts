import { Schema, Types, model } from 'mongoose'

// One generated pre-survey checklist for an assessment (CP-30). Each generation
// is a new document and the latest is shown, so regenerating never loses one
// (CP-32 compares against it). Written by checklist.service; see
// docs/areas/database.md.

// Where an item came from: the report template; the model, from a standard
// ('standard') or for a configured hazard ('hazard'); or the hazard list's own
// item when the model wrote none for it ('hazard_list'). Only 'standard' and
// 'hazard' are AI-written (AC8). CP-32 adds 'manual' and CP-33 'recommended'.
export const ITEM_ORIGINS = ['template', 'standard', 'hazard', 'hazard_list'] as const
// 'uncited': the item rests on no passage, e.g. a hazard whose standards the
// knowledge base doesn't hold (AC7).
export const ITEM_FLAGS = ['uncited'] as const

export interface IChecklistCitation {
  // `C:<chunk id>`, a key of the checklist's `sources`.
  ref: string
  // The passage's own words the item rests on (AC6), and whether they were
  // found in it.
  quote: string
  quoteFound: boolean
}

export interface IChecklistItem {
  _id: Types.ObjectId
  // A report section ('7') or 'hazards'.
  area: string
  subsection: string | null
  origin: (typeof ITEM_ORIGINS)[number]
  hazard: string | null
  text: string
  // The template subsection's fields, e.g. Power's Site Feed.
  fields: string[]
  COPE_dimension: string[]
  citations: IChecklistCitation[]
  flags: (typeof ITEM_FLAGS)[number][]
  // Left empty by CP-30 so later stories need no migration: CP-32 removes items
  // and CP-33 suggests them; CP-34 pre-fills a value; CP-31 records the check.
  status: 'active'
  prefill: null
  check: null
}

export interface IChecklist {
  assessment: Types.ObjectId
  // The site's facility type and country when it was generated (AC1).
  facilityType: string
  jurisdiction: string
  // The standards the engineer kept in scope (AC2), as they were then.
  standards: {
    id: string
    title: string
    sourceType: string | null
    standardNumber: string | null
    edition: string | null
  }[]
  items: IChecklistItem[]
  // The report areas the items fall under, in report order, with their titles.
  areas: { id: string; title: string }[]
  // The configured hazards and which of their named standards were in scope (AC7).
  hazards: { id: string; name: string; standards: string[]; inScope: string[] }[]
  // The cited passages, keyed by `C:<chunk id>`, as they were when generated.
  sources: Record<string, unknown>
  provenance: {
    provider: string
    // Null when no standard was in scope, so no model was called (AC10).
    model: string | null
    effort: string
    prompt_version: string
    checklist_version: string
    template_version: string
    generated_at: Date
  }
  createdBy: Types.ObjectId
  // Required on every document (see CLAUDE.md). A checklist covers every
  // category, so COPE_dimension is 'all'; each item carries its own.
  metadata: {
    source_type: 'checklist'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const citationSchema = new Schema<IChecklistCitation>(
  {
    ref: { type: String, required: true },
    quote: { type: String, required: true },
    quoteFound: { type: Boolean, required: true },
  },
  { _id: false },
)

const itemSchema = new Schema<IChecklistItem>({
  area: { type: String, required: true },
  subsection: { type: String, default: null },
  origin: { type: String, enum: ITEM_ORIGINS, required: true },
  hazard: { type: String, default: null },
  text: { type: String, required: true },
  fields: { type: [String], default: [] },
  COPE_dimension: { type: [String], default: [] },
  citations: { type: [citationSchema], default: [] },
  flags: { type: [String], enum: ITEM_FLAGS, default: [] },
  status: { type: String, enum: ['active'], default: 'active' },
  prefill: { type: Schema.Types.Mixed, default: null },
  check: { type: Schema.Types.Mixed, default: null },
})

const checklistSchema = new Schema<IChecklist>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    facilityType: { type: String, required: true },
    jurisdiction: { type: String, required: true },
    standards: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          title: { type: String, required: true },
          sourceType: { type: String, default: null },
          standardNumber: { type: String, default: null },
          edition: { type: String, default: null },
        },
      ],
      default: [],
    },
    items: { type: [itemSchema], default: [] },
    areas: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          title: { type: String, required: true },
        },
      ],
      default: [],
    },
    hazards: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          name: { type: String, required: true },
          standards: { type: [String], default: [] },
          inScope: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    sources: { type: Schema.Types.Mixed, default: {} },
    provenance: {
      provider: { type: String, required: true },
      model: { type: String, default: null },
      effort: { type: String, required: true },
      prompt_version: { type: String, required: true },
      checklist_version: { type: String, required: true },
      template_version: { type: String, required: true },
      generated_at: { type: Date, required: true },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: {
      source_type: { type: String, enum: ['checklist'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'checklists', minimize: false },
)

// The latest checklist of an assessment is read on every visit to its tab.
checklistSchema.index({ assessment: 1, createdAt: -1 })

export const ChecklistModel = model<IChecklist>('Checklist', checklistSchema)
