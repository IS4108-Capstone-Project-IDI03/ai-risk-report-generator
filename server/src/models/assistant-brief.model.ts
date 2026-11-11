// MarshBot's brief for one assessment (AS-06): its stage, the items the checks
// raised (open and recently resolved), the checklist by area, the report
// outline, the coverage check and the AI's wording. Written by
// services/assistant/recheck.service.ts and coverage.service.ts; read by
// brief.service.ts and focus.service.ts.
// Not a knowledge or observation document, so the metadata-fields rule doesn't apply.
import { Schema, Types, model } from 'mongoose'
import {
  STAGES,
  type AreaHealth,
  type BriefItem,
  type SectionState,
  type Stage,
  type ThreadEntry,
} from '../services/assistant/types'

// What the coverage check (AC 7) last found, and where it stands.
export type CoverageState = {
  status: 'idle' | 'running' | 'done' | 'failed'
  startedAt: Date | null
  checkedAt: Date | null
  // The evidence fingerprint it checked; a different one makes it due again.
  fingerprint: string | null
  uncovered: string[] // checklist item ids no observation covers
  thin: { observationId: string; sectionId: string; reason: string }[]
}

export interface IAssistantBrief {
  assessment: Types.ObjectId
  reference: string
  stage: Stage
  // Open items and the last resolved ones (resolvedAt set).
  items: BriefItem[]
  areas: AreaHealth[]
  sections: SectionState[]
  // The plain facts the messages are written from (counts, dates, names); see recheck.service.ts.
  facts: Record<string, unknown>
  coverage: CoverageState
  // The AI's OpenUI programs by message id, for the message set `key` names.
  wording: { key: string | null; programs: Record<string, string> }
  thread: ThreadEntry[]
  // A fingerprint of everything above but wording, so an unchanged re-check saves and pushes nothing.
  contentHash: string
  updatedAt: Date
}

const briefSchema = new Schema<IAssistantBrief>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, unique: true },
    reference: { type: String, required: true, index: true },
    stage: { type: String, enum: STAGES, required: true },
    // Mixed: shapes fixed by types.ts and written only by the assistant services.
    items: { type: Schema.Types.Mixed, default: [] },
    areas: { type: Schema.Types.Mixed, default: [] },
    sections: { type: Schema.Types.Mixed, default: [] },
    facts: { type: Schema.Types.Mixed, default: {} },
    coverage: {
      status: { type: String, enum: ['idle', 'running', 'done', 'failed'], default: 'idle' },
      startedAt: { type: Date, default: null },
      checkedAt: { type: Date, default: null },
      fingerprint: { type: String, default: null },
      uncovered: { type: [String], default: [] },
      thin: { type: Schema.Types.Mixed, default: [] },
    },
    wording: {
      key: { type: String, default: null },
      programs: { type: Schema.Types.Mixed, default: {} },
    },
    thread: { type: Schema.Types.Mixed, default: [] },
    contentHash: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'assistant_briefs',
    minimize: false,
  },
)

export const AssistantBriefModel = model<IAssistantBrief>('AssistantBrief', briefSchema)
