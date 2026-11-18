// The run record (GN-13): one per assessment, saying where each AI-drafted part
// (Sections 2 to 12) stands in the background and which drafting run is current.
// Written by services/generation/drafting-run.service.ts (and Section 3's
// baseline fingerprint by generation.service.ts); read by generation.service.ts
// and summary.service.ts.
import { Schema, Types, model } from 'mongoose'

export const PART_JOB_STATUSES = ['queued', 'drafting', 'done', 'failed'] as const
export type PartJobStatus = (typeof PART_JOB_STATUSES)[number]

// A part's latest background job: a run's or one from Review.
export interface IPartJob {
  status: PartJobStatus
  // `regenerate` writes a replacement (Sections 4 to 12 from Review); `draft` everything else.
  action: 'draft' | 'regenerate'
  instruction: string | null
  // Failed tries of this job so far.
  attempts: number
  // The plain reason, once failed.
  error: string | null
  // The engineer the job drafts as: the drafting functions check they are assigned.
  requestedBy: { id: string; role: string; name: string }
  requestedAt: Date
  finishedAt: Date | null
}

export interface IDraftingRun {
  assessment: Types.ObjectId
  reference: string
  // By part id ('2' to '12'); a part never asked for has no entry.
  parts?: Record<string, IPartJob>
  // The current or last drafting run; absent before the first.
  run?: {
    // What one press drafts, in order.
    parts: string[]
    startedBy: { id: string; name: string }
    startedAt: Date
    // Null while it runs.
    finishedAt: Date | null
  }
  // A fingerprint (short hash) of the usable observations when a job last
  // drafted Section 3, for its out-of-date check; null until then. OFIs from
  // before GN-13 get one the first time the drafting state is read (a baseline).
  // Set, it also says Section 3 is drafted when the AI suggested no OFIs.
  ofiEvidence: string | null
  // When a job last drafted Section 3: its draft time when there are no OFIs.
  ofiEvidenceAt?: Date | null
  metadata: {
    source_type: 'drafting_run'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
}

const draftingRunSchema = new Schema<IDraftingRun>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, unique: true },
    // Indexed: the worker and the guard find the record by it.
    reference: { type: String, required: true, index: true },
    // Mixed: written with dotted paths (`parts.7.status`) so each part is claimed
    // atomically. No defaults: an upsert setting `parts.7` would clash with one.
    parts: { type: Schema.Types.Mixed },
    run: { type: Schema.Types.Mixed },
    ofiEvidence: { type: String, default: null },
    ofiEvidenceAt: { type: Date },
    metadata: {
      source_type: { type: String, enum: ['drafting_run'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      // A run covers the whole report.
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'drafting_runs', minimize: false },
)

export const DraftingRunModel = model<IDraftingRun>('DraftingRun', draftingRunSchema)
