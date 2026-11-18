// What Generation is told about the report's drafting (GN-13): the three steps,
// each part's state, and the checkpoint the report waits at. Built by
// generation.service.ts, sent by routes/generation.routes.ts, and read by MarshBot.
// must match client/src/features/assessments/generation/types.ts

// A part is an AI-drafted piece of the report: Sections 2 to 12.
// Step 1 drafts these from observations; step 3 drafts the rest from the engineer's input.
export const STEP_ONE_PARTS = ['3', '6', '7', '8', '9', '10', '11', '12']
// Section 2 is last: it summarises the others.
export const STEP_THREE_PARTS = ['4', '5', '2']
// The order a whole report is drafted in, and the order of the report bar's segments.
export const RUN_ORDER = [...STEP_ONE_PARTS, ...STEP_THREE_PARTS]

// Why a drafted part is out of date: its inputs changed after it was written.
export type OutOfDate =
  | { why: 'observations' | 'figures' | 'scope' }
  // Section 2 only: a section it summarises changed or is about to be redrafted.
  | { why: 'section'; section: string }

export interface GenerationPart {
  id: string
  title: string
  step: 1 | 3
  // Has a draft now (Section 3: OFIs were suggested). Stays true while it is redrafted.
  drafted: boolean
  draftedAt: string | null
  // Background work on this part: waiting its turn, being drafted now, or its last try failed.
  job: 'queued' | 'drafting' | 'failed' | null
  // How many times drafting was tried, once it has failed; else 0.
  attempts: number
  error: string | null
  outOfDate: OutOfDate | null
  // Step 1 parts: usable observations filed under it (Section 3: all of them). Step 3: null.
  observations: number | null
}

// The engineer's three tasks in step 2, each done in Review.
export interface GenerationTask {
  id: 'ofi' | 'scores' | 'losses'
  section: '3' | '4' | '5'
  done: boolean
}

// The point the report waits at. Generation's header and MarshBot both read this one value.
export type Checkpoint =
  // A part to draft has no usable observation.
  | { kind: 'needs_observations'; sections: string[] }
  // Recordings are still being transcribed; `parts` is what the greyed button would draft.
  | { kind: 'transcribing'; recordings: number; parts: string[] }
  // One press drafts `parts`, in this order (out-of-date parts first, Section 2 last).
  | { kind: 'ready'; step: 1 | 3; parts: string[] }
  // A drafting run is working through `parts`; `done` of them have finished.
  | { kind: 'drafting'; step: 1 | 3; parts: string[]; done: number }
  // `failed` were not drafted after every retry; Try again drafts `parts`.
  | { kind: 'failed'; failed: string[]; parts: string[] }
  // Step 2: the engineer still has tasks to do in Review.
  | { kind: 'input_needed' }
  // All 11 parts are drafted and up to date.
  | { kind: 'drafted' }
  // All 11 are drafted, but `parts` are out of date; one press redrafts them.
  | { kind: 'out_of_date'; parts: string[] }

export type StepState = 'next' | 'now' | 'done'

export interface GenerationDto {
  checkpoint: Checkpoint
  // Only the assigned engineer starts drafting; an admin just watches.
  canStart: boolean
  // How many of the 11 parts have a draft.
  drafted: number
  // All 11, in RUN_ORDER.
  parts: GenerationPart[]
  tasks: GenerationTask[]
  steps: {
    // `parts` is the rows the step's card lists, in order. Step 3 also lists an
    // out-of-date step 1 part it will redraft first.
    one: { state: StepState; draftedAt: string | null; parts: string[] }
    two: { state: StepState }
    three: { state: StepState; draftedAt: string | null; parts: string[] }
  }
}
