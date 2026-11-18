// One drafting state per approved Generation board (GN-13 boards 01 to 11), for the screen's
// tests and the screenshot pass. Read by draftingSteps.test.tsx; `reportDrafted` also answers
// `…/generation` in the tests that open Review. Shapes must match types.ts.
import { RUN_ORDER, STEP_ONE_PARTS } from './types'
import type { GenerationDto, GenerationPart, GenerationTask } from './types'

const TITLES: Record<string, string> = {
  '2': 'Executive Summary',
  '3': 'Opportunities for Improvement',
  '4': 'Risk Quality Ratings and Comments',
  '5': 'Loss Estimates',
  '6': 'Management Programs',
  '7': 'Construction',
  '8': 'Occupancy, Hazards, and Utilities',
  '9': 'Fire Protection',
  '10': 'External Exposures',
  '11': 'Security',
  '12': 'Business Interruption',
}
// Board 01's observation counts.
const OBSERVATIONS: Record<string, number> = {
  '3': 12,
  '6': 2,
  '7': 2,
  '8': 3,
  '9': 3,
  '10': 1,
  '11': 1,
  '12': 1,
}

// Today at a time of day, so "Drafted today, 2:14 pm" reads as on the boards.
const today = (h: number, m: number) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const STEP_ONE_AT = today(14, 14)
const STEP_THREE_AT = today(15, 2)

// All 11 parts, none drafted; `change` overrides some of them.
function parts(change: Record<string, Partial<GenerationPart>> = {}): GenerationPart[] {
  return RUN_ORDER.map((id) => ({
    id,
    title: TITLES[id],
    step: STEP_ONE_PARTS.includes(id) ? 1 : 3,
    drafted: false,
    draftedAt: null,
    job: null,
    attempts: 0,
    error: null,
    outOfDate: null,
    observations: STEP_ONE_PARTS.includes(id) ? OBSERVATIONS[id] : null,
    ...change[id],
  }))
}
const drafted = (at: string, ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { drafted: true, draftedAt: at }]))
const tasks = (...done: GenerationTask['id'][]): GenerationTask[] => [
  { id: 'ofi', section: '3', done: done.includes('ofi') },
  { id: 'scores', section: '4', done: done.includes('scores') },
  { id: 'losses', section: '5', done: done.includes('losses') },
]
const STEP_THREE = ['4', '5', '2']
const ALL_DRAFTED = {
  ...drafted(STEP_ONE_AT, STEP_ONE_PARTS),
  ...drafted(STEP_THREE_AT, STEP_THREE),
}

const base: GenerationDto = {
  checkpoint: { kind: 'ready', step: 1, parts: STEP_ONE_PARTS },
  canStart: true,
  drafted: 0,
  parts: parts(),
  tasks: tasks(),
  steps: {
    one: { state: 'now', draftedAt: null, parts: STEP_ONE_PARTS },
    two: { state: 'next' },
    three: { state: 'next', draftedAt: null, parts: STEP_THREE },
  },
}
const afterStepOne = {
  ...base.steps,
  one: { state: 'done', draftedAt: STEP_ONE_AT, parts: STEP_ONE_PARTS },
  two: { state: 'done' },
} as const

/** Board 01: ready for step 1, every section has observations. */
export const checkReady: GenerationDto = base

/** Board 02: step 1 running, 3 of 8 drafted. */
export const draftingFromObservations: GenerationDto = {
  ...base,
  checkpoint: { kind: 'drafting', step: 1, parts: STEP_ONE_PARTS, done: 3 },
  drafted: 3,
  parts: parts({
    ...drafted(STEP_ONE_AT, ['6', '7', '8']),
    '3': { job: 'drafting' },
    '9': { job: 'drafting' },
    '10': { job: 'drafting' },
    '11': { job: 'queued' },
    '12': { job: 'queued' },
  }),
}

/** Board 03: step 2, the engineer has accepted an OFI only. */
export const inputNeeded: GenerationDto = {
  ...base,
  checkpoint: { kind: 'input_needed' },
  drafted: 8,
  parts: parts(drafted(STEP_ONE_AT, STEP_ONE_PARTS)),
  tasks: tasks('ofi'),
  steps: { ...afterStepOne, two: { state: 'now' } },
}

/** Board 04: ready for step 3, Section 7 out of date and redrafted in the same run. */
export const readyFromInput: GenerationDto = {
  ...base,
  checkpoint: { kind: 'ready', step: 3, parts: ['7', ...STEP_THREE] },
  drafted: 8,
  parts: parts({
    ...drafted(STEP_ONE_AT, STEP_ONE_PARTS),
    '7': { drafted: true, draftedAt: STEP_ONE_AT, outOfDate: { why: 'observations' } },
  }),
  tasks: tasks('ofi', 'scores', 'losses'),
  steps: { ...afterStepOne, three: { state: 'now', draftedAt: null, parts: STEP_THREE } },
}

/** Board 05: step 3 running, Section 7 redrafted, Sections 4 and 5 drafting. */
export const draftingFromInput: GenerationDto = {
  ...readyFromInput,
  checkpoint: { kind: 'drafting', step: 3, parts: ['7', ...STEP_THREE], done: 1 },
  parts: parts({
    ...drafted(STEP_ONE_AT, STEP_ONE_PARTS),
    '4': { job: 'drafting' },
    '5': { job: 'drafting' },
    '2': { job: 'queued' },
  }),
}

/** Board 06: all 11 drafted. */
export const reportDrafted: GenerationDto = {
  ...base,
  checkpoint: { kind: 'drafted' },
  drafted: 11,
  parts: parts(ALL_DRAFTED),
  tasks: tasks('ofi', 'scores', 'losses'),
  steps: {
    ...afterStepOne,
    three: { state: 'done', draftedAt: STEP_THREE_AT, parts: STEP_THREE },
  },
}

/** Board 07: Sections 10 and 11 have no observations. */
export const noObservations: GenerationDto = {
  ...base,
  checkpoint: { kind: 'needs_observations', sections: ['10', '11'] },
  parts: parts({ '3': { observations: 10 }, '10': { observations: 0 }, '11': { observations: 0 } }),
}

/** Board 08: 2 recordings still transcribing. */
export const transcribing: GenerationDto = {
  ...base,
  checkpoint: { kind: 'transcribing', recordings: 2, parts: STEP_ONE_PARTS },
}

/** Board 09: Section 9 failed after 3 attempts; the other 7 are drafted. */
export const sectionNotDrafted: GenerationDto = {
  ...base,
  checkpoint: { kind: 'failed', failed: ['9'], parts: ['9'] },
  drafted: 7,
  parts: parts({
    ...drafted(
      STEP_ONE_AT,
      STEP_ONE_PARTS.filter((id) => id !== '9'),
    ),
    '9': { job: 'failed', attempts: 3, error: 'The model did not answer.' },
  }),
}

/** Board 10: everything drafted, then Section 7's observations changed (and so Section 2). */
export const outOfDate: GenerationDto = {
  ...reportDrafted,
  checkpoint: { kind: 'out_of_date', parts: ['7', '2'] },
  parts: parts({
    ...ALL_DRAFTED,
    '7': { drafted: true, draftedAt: STEP_ONE_AT, outOfDate: { why: 'observations' } },
    '2': { drafted: true, draftedAt: STEP_THREE_AT, outOfDate: { why: 'section', section: '7' } },
  }),
}

/** Board 11: an admin opens someone else's assessment, ready for step 1. */
export const adminViewOnly: GenerationDto = { ...base, canStart: false }
