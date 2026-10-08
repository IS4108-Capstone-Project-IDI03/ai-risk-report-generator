// One run of the evidence and structure checks on a drafted report (EV-01).
// Written by services/evidence-check.service.ts. The run's own _id is the
// "evaluation run ID" that every individual check result is kept under.
import { Schema, Types, model } from 'mongoose'

export const CHECK_NAMES = [
  'required-section',
  'heading-structure',
  'finding-has-evidence',
  'citation-resolves',
] as const
export const CHECK_RESULTS = ['pass', 'fail', 'warn', 'unverified'] as const

export interface IEvaluationCheck {
  // The template section the check is about, '7' to '12'.
  sectionId: string
  check: (typeof CHECK_NAMES)[number]
  // What was checked: a heading, "Heading #2" for a statement, or a citation id.
  target: string
  result: (typeof CHECK_RESULTS)[number]
  detail: string
}

export interface IEvaluationRun {
  assessment: Types.ObjectId
  // The assessment reference, e.g. RPT-2026-0901.
  reference: string
  createdBy: Types.ObjectId
  // The template version the drafts were compared with.
  templateVersion: string
  summary: {
    passed: number
    failed: number
    warned: number
    unverified: number
    // 'incomplete' when a check could not be made (e.g. the passage lookup was down).
    status: 'complete' | 'incomplete'
  }
  checks: IEvaluationCheck[]
  // Required on every document (see CLAUDE.md).
  metadata: {
    source_type: 'evaluation_run'
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
}

const evaluationRunSchema = new Schema<IEvaluationRun>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    reference: { type: String, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    templateVersion: { type: String, required: true },
    summary: {
      passed: { type: Number, required: true },
      failed: { type: Number, required: true },
      warned: { type: Number, required: true },
      unverified: { type: Number, required: true },
      status: { type: String, enum: ['complete', 'incomplete'], required: true },
    },
    checks: [
      {
        _id: false,
        sectionId: { type: String, required: true },
        check: { type: String, enum: CHECK_NAMES, required: true },
        target: { type: String, required: true },
        result: { type: String, enum: CHECK_RESULTS, required: true },
        detail: { type: String, required: true },
      },
    ],
    metadata: {
      source_type: { type: String, enum: ['evaluation_run'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'evaluation_runs' },
)

export const EvaluationRunModel = model<IEvaluationRun>('EvaluationRun', evaluationRunSchema)
