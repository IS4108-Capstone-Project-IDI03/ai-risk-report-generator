// An assessment's stage (AS-06 "Stage rules"): the furthest stage its data
// proves, and the forward-only move to it. Called by recheck.service.ts.
import type { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { STAGES, type Stage } from './types'

export const STAGE_LABELS: Record<Stage, string> = {
  setup: 'Setup',
  prepare: 'Prepare',
  capture: 'Capture',
  ready_for_generation: 'Ready for generation',
  generate: 'Generate',
  review: 'Review',
  ready_to_export: 'Ready to export',
  exported: 'Exported',
}

/** Returns the stage's position, 0 (Setup) to 7 (Exported). */
export const stageIndex = (stage: Stage) => STAGES.indexOf(stage)

/** Returns the later of two stages. */
export const laterStage = (a: Stage, b: Stage): Stage => (stageIndex(a) >= stageIndex(b) ? a : b)

// What the data says has happened, each a reason to be at least that stage.
export type StageSignals = {
  setupConfirmed: boolean
  checklist: boolean
  captureStarted: boolean // a capture session, an observation or a site walk
  readyToGenerate: boolean // told MarshBot, or completed the capture session
  generationWork: boolean // any draft, OFI, summary, figures or figure proposal
  reviewStarted: boolean // a review decision, or all parts drafted
  exportClear: boolean // exportBlockers is empty
  exported: boolean
}

/**
 * Returns the furthest stage the signals prove. Ready to export also needs the
 * assessment to be in Review already (`stored` or proven), so an empty report
 * with nothing blocking it never skips straight there.
 */
export function deriveStage(s: StageSignals, stored: Stage): Stage {
  if (s.exported) return 'exported'
  const proven: Stage = s.reviewStarted
    ? 'review'
    : s.generationWork
      ? 'generate'
      : s.readyToGenerate
        ? 'ready_for_generation'
        : s.captureStarted
          ? 'capture'
          : s.setupConfirmed || s.checklist
            ? 'prepare'
            : 'setup'
  return s.exportClear && stageIndex(laterStage(proven, stored)) >= stageIndex('review')
    ? 'ready_to_export'
    : proven
}

/**
 * Moves the assessment forward to `derived` if that is later than `stored`,
 * dating every stage passed with `now` (skipped stages share the date), and
 * returns the stage it is in now. Never moves back.
 */
export async function advanceStage(
  assessment: {
    _id: Types.ObjectId
    stage?: Stage
    stageDates?: Partial<Record<Stage, Date>>
    createdAt: Date
  },
  derived: Stage,
  now: Date,
): Promise<Stage> {
  const stored = assessment.stage ?? 'setup'
  const target = laterStage(stored, derived)
  const dates = assessment.stageDates ?? {}
  if (target === stored && dates.setup) return stored
  const $set: Record<string, unknown> = { stage: target }
  if (!dates.setup) $set['stageDates.setup'] = assessment.createdAt
  for (const s of STAGES.slice(stageIndex(stored) + 1, stageIndex(target) + 1))
    $set[`stageDates.${s}`] = now
  // Matching on the stage read means a re-check racing this one can't move it back.
  await AssessmentModel.updateOne(
    { _id: assessment._id, stage: assessment.stage ?? null },
    { $set },
  )
  return target
}
