// The one check of where a report's drafting stands (GN-13): each part, the
// engineer's three tasks, the three steps and the checkpoint the report waits at.
// Called by routes/generation.routes.ts and drafting-run.service.ts; MarshBot reads
// draftingState (assistant/context.ts), so the two never disagree. Calls the section, summary
// and observation services and reads the run record (drafting_runs).
import { createHash } from 'node:crypto'
import { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { DraftingRunModel, type IDraftingRun, type IPartJob } from '../../models/drafting-run.model'
import { ReportOfiModel } from '../../models/report-ofi.model'
import type { ISite } from '../../models/site.model'
import type { SessionUser } from '../auth.service'
import { AssessmentNotFoundError } from '../capture-session.service'
import { isDuplicateKeyError } from '../mongo-errors'
import { listObservations, type ObservationDto } from '../observation.service'
import { permissionsFor } from '../permissions.service'
import { figureFacts, isUsable, loadSections, toEvidence } from '../section.service'
import { getSummary, SUMMARISED_SECTIONS } from '../summary.service'
import {
  RUN_ORDER,
  STEP_ONE_PARTS,
  STEP_THREE_PARTS,
  type Checkpoint,
  type GenerationDto,
  type GenerationPart,
  type GenerationTask,
  type OutOfDate,
} from './types'

/** The job statuses still to finish: waiting its turn or being drafted now. */
export const RUNNING: readonly string[] = ['queued', 'drafting']
/** Returns true while the job is queued or drafting. */
export const isRunning = (job?: IPartJob) => RUNNING.includes(job?.status ?? '')

/** Returns what a run record is created with: its reference and the required metadata (CLAUDE.md). */
export const onInsert = (
  assessment: { reference: string; site: Pick<ISite, 'jurisdiction' | 'facilityType'> | null },
  at: Date,
) => ({
  reference: assessment.reference,
  metadata: {
    source_type: 'drafting_run',
    jurisdiction: assessment.site!.jurisdiction,
    facility_type: assessment.site!.facilityType,
    COPE_dimension: 'all',
    effective_date: at,
  },
})

const TITLES = new Map([
  ['2', 'Executive Summary'],
  ...SUMMARISED_SECTIONS.map((s) => [s.id, s.title] as const),
])

// Usable evidence (a note or a finished transcript) under at least one category,
// as drafting reads it; uncategorised observations stay out (CP-02).
const usableOf = (observations: ObservationDto[]) =>
  observations.filter((o) => o.copeDimensions && isUsable(o))

/** Returns a short hash of the usable observations, which changes when one is added, changed or removed. */
export function evidenceFingerprint(observations: ObservationDto[]): string {
  // Sorted by id, so the order they were listed in doesn't change it.
  const evidence = usableOf(observations)
    .map(toEvidence)
    .sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha1').update(JSON.stringify(evidence)).digest('hex').slice(0, 16)
}

// Recordings and handwritten pages still transcribing: a draft would miss them,
// so draftingEvidence refuses to draft (section.service.ts).
const transcribingCount = (observations: ObservationDto[]) =>
  observations
    .filter((o) => o.copeDimensions)
    .flatMap((o) => [...o.recordings, ...o.pages])
    .filter((m) => m.transcription.status === 'transcribing').length

const newest = (dates: (string | null)[]) =>
  dates.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null)

export type DraftingState = Omit<GenerationDto, 'canStart'>

type Own = Pick<GenerationPart, 'drafted' | 'draftedAt' | 'outOfDate' | 'observations'>
type Inputs = Awaited<ReturnType<typeof readInputs>>
type States = Map<string, Own>

// OFIs suggested before GN-13 (and seeded ones) have no fingerprint. The first
// read saves today's as their baseline, so every later observation change shows
// Section 3 out of date; changes made before that first read are not seen.
// Returns the fingerprint saved.
async function baselineOfiEvidence(
  assessment: Parameters<typeof onInsert>[0] & { _id: Types.ObjectId },
  observations: ObservationDto[],
) {
  const fingerprint = evidenceFingerprint(observations)
  try {
    await DraftingRunModel.updateOne(
      { assessment: assessment._id, ofiEvidence: null },
      { $set: { ofiEvidence: fingerprint }, $setOnInsert: onInsert(assessment, new Date()) },
      { upsert: true },
    )
  } catch (error) {
    // Two reads at once: the loser's insert clashes on the unique assessment,
    // and the winner saved the same baseline. Without this, one read would fail.
    if (!isDuplicateKeyError(error)) throw error
  }
  return fingerprint
}

// a. Everything the check reads, at once. Nothing here is stored: the run
// record holds only the jobs, and drafts and OFIs say what is drafted.
async function readInputs(reference: string) {
  const assessment = await AssessmentModel.findOne(
    { reference },
    '_id reference engineer archivedAt riskQuality lossEstimates site',
  )
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const [sections, summary, observations, ofis, record] = await Promise.all([
    loadSections(reference),
    getSummary(reference),
    listObservations(reference),
    ReportOfiModel.find({ assessment: assessment._id }, 'state createdAt').lean(),
    DraftingRunModel.findOne({ assessment: assessment._id }).lean<IDraftingRun>(),
  ])
  const ofiEvidence =
    record?.ofiEvidence ??
    (ofis.length && assessment.site ? await baselineOfiEvidence(assessment, observations) : null)
  const run = record?.run && !record.run.finishedAt ? record.run : null
  return {
    assessment,
    sections,
    summary,
    observations,
    ofis,
    record,
    jobs: record?.parts ?? {},
    ofiEvidence,
    run,
  }
}

// b. Each part on its own: drafted, and out of date when its inputs changed
// since. Never out of date while a job runs on it: it is being redrafted.
function partStates(inputs: Inputs): States {
  const { sections, summary, observations, ofis, record, jobs, ofiEvidence } = inputs
  const bySection = new Map(sections.map((s) => [s.section.id, s]))
  const usable = usableOf(observations)
  const own = (id: string): Own => {
    const idle = !isRunning(jobs[id])
    if (id === '3') {
      // Drafted once OFIs were suggested, or a job found none to suggest (rule 5).
      // The fingerprint is saved only by a job that drafted it, so a redraft
      // queued from Review doesn't make Section 3 read as not drafted.
      const drafted = ofis.length > 0 || !!ofiEvidence
      const draftedAt = ofis.length
        ? newest(ofis.map((o) => o.createdAt.toISOString()))
        : (record?.ofiEvidenceAt?.toISOString() ?? null)
      const changed = !!ofiEvidence && ofiEvidence !== evidenceFingerprint(observations)
      return {
        drafted,
        draftedAt,
        outOfDate: drafted && idle && changed ? { why: 'observations' } : null,
        observations: usable.length,
      }
    }
    if (id === '2') {
      const draft = summary.executiveSummary.draft
      // Section 2's other reason is worked out below, once the others are known.
      const stale = summary.executiveSummary.staleSections[0]?.id
      return {
        drafted: !!draft,
        draftedAt: draft ? new Date(draft.createdAt).toISOString() : null,
        outOfDate: draft && idle && stale ? { why: 'section', section: stale } : null,
        observations: null,
      }
    }
    const loaded = bySection.get(id)
    const latest = loaded?.latest ?? null
    const counts = loaded?.changeCounts
    const why: OutOfDate | null = !counts
      ? null
      : counts.figures
        ? { why: 'figures' }
        : counts.scope
          ? { why: 'scope' }
          : counts.added + counts.changed + counts.removed
            ? { why: 'observations' }
            : null
    return {
      drafted: !!latest,
      draftedAt: latest ? latest.createdAt.toISOString() : null,
      outOfDate: latest && idle ? why : null,
      observations: STEP_ONE_PARTS.includes(id) ? (loaded?.usableObservations ?? 0) : null,
    }
  }
  const states = new Map(RUN_ORDER.map((id) => [id, own(id)]))
  // Section 2 is out of date too while another part is: redrafting that part
  // changes what Section 2 summarises.
  const two = states.get('2')!
  const firstOutOfDate = RUN_ORDER.find((id) => id !== '2' && states.get(id)!.outOfDate)
  if (two.drafted && !two.outOfDate && !isRunning(jobs['2']) && firstOutOfDate)
    two.outOfDate = { why: 'section', section: firstOutOfDate }
  return states
}

// c. The engineer's three tasks in Review.
function tasksOf({ assessment, ofis }: Inputs, states: States): GenerationTask[] {
  return [
    {
      id: 'ofi',
      section: '3',
      // Rule 5: when the AI suggested none, there is nothing to accept.
      done: ofis.some((o) => o.state === 'accepted') || (states.get('3')!.drafted && !ofis.length),
    },
    { id: 'scores', section: '4', done: !figureFacts('4', assessment).missing },
    { id: 'losses', section: '5', done: !figureFacts('5', assessment).missing },
  ]
}

// d. The plan: what one press drafts, in order. Out-of-date parts first, then
// the parts the current step allows, Section 2 always last. Step 3's parts
// need the engineer's tasks (their figures and OFIs) done.
function planOf({ jobs }: Inputs, states: States, tasksDone: boolean): string[] {
  const drafted = (id: string) => states.get(id)!.drafted
  const plan: string[] = []
  const allowed = (id: string) => !STEP_THREE_PARTS.includes(id) || tasksDone
  const waiting = (id: string) => !drafted(id) && !isRunning(jobs[id])
  for (const id of RUN_ORDER)
    if (id !== '2' && states.get(id)!.outOfDate && allowed(id)) plan.push(id)
  for (const id of STEP_ONE_PARTS) if (waiting(id)) plan.push(id)
  const covered = (id: string) => drafted(id) || plan.includes(id)
  if (STEP_ONE_PARTS.every(covered) && tasksDone)
    for (const id of ['4', '5']) if (waiting(id)) plan.push(id)
  if (
    (states.get('2')!.outOfDate || waiting('2')) &&
    tasksDone &&
    RUN_ORDER.every((id) => id === '2' || covered(id))
  )
    plan.push('2')
  return plan
}

// e. The checkpoint: the first that matches wins.
function checkpointOf(
  { jobs, observations, run }: Inputs,
  states: States,
  plan: string[],
  tasksDone: boolean,
): Checkpoint {
  const drafted = (id: string) => states.get(id)!.drafted
  // Only a failed part Try again would draft: one now waiting on the engineer
  // (figures cleared since) is the step 2 checkpoint's business instead.
  const failed = plan.filter((id) => jobs[id]?.status === 'failed' && !drafted(id))
  const transcribing = transcribingCount(observations)
  const empty = plan.filter((id) => STEP_ONE_PARTS.includes(id) && !states.get(id)!.observations)
  if (run)
    return {
      kind: 'drafting',
      step: run.parts.some((id) => STEP_THREE_PARTS.includes(id)) ? 3 : 1,
      parts: run.parts,
      // "N of M" counts drafted parts only: a failed one is not drafted.
      done: run.parts.filter((id) => jobs[id]?.status === 'done').length,
    }
  // What blocks drafting comes before Try again: retrying would only fail again.
  if (plan.length && transcribing)
    return { kind: 'transcribing', recordings: transcribing, parts: plan }
  if (empty.length) return { kind: 'needs_observations', sections: empty }
  if (failed.length) return { kind: 'failed', failed, parts: plan }
  if (!STEP_ONE_PARTS.every(drafted)) return { kind: 'ready', step: 1, parts: plan }
  if (!tasksDone) return { kind: 'input_needed' }
  if (!STEP_THREE_PARTS.every(drafted)) return { kind: 'ready', step: 3, parts: plan }
  return plan.length ? { kind: 'out_of_date', parts: plan } : { kind: 'drafted' }
}

// Each part as Generation lists it: its own state and its latest job.
function partsOf({ jobs }: Inputs, states: States): GenerationPart[] {
  return RUN_ORDER.map((id) => {
    const job = jobs[id]
    const failedJob = job?.status === 'failed'
    return {
      id,
      title: TITLES.get(id) ?? `Section ${id}`,
      step: STEP_ONE_PARTS.includes(id) ? 1 : 3,
      ...states.get(id)!,
      job: job && job.status !== 'done' ? job.status : null,
      attempts: failedJob ? job.attempts : 0,
      error: failedJob ? job.error : null,
    }
  })
}

// f. The three steps, as Generation's cards show them.
function stepsOf(
  { run }: Inputs,
  states: States,
  plan: string[],
  tasksDone: boolean,
): DraftingState['steps'] {
  const drafted = (id: string) => states.get(id)!.drafted
  const oneDone = STEP_ONE_PARTS.every(drafted)
  const threeState = !oneDone || !tasksDone ? 'next' : RUN_ORDER.every(drafted) ? 'done' : 'now'
  const draftedAtOf = (ids: string[]) => newest(ids.map((id) => states.get(id)!.draftedAt))
  // While step 3 is current its card also lists the step 1 parts it redrafts
  // first: the running run's, else the plan's.
  const redrafts = (run?.parts ?? plan).filter((id) => STEP_ONE_PARTS.includes(id))
  return {
    one: {
      state: oneDone ? 'done' : 'now',
      draftedAt: oneDone ? draftedAtOf(STEP_ONE_PARTS) : null,
      parts: STEP_ONE_PARTS,
    },
    two: { state: !oneDone ? 'next' : tasksDone ? 'done' : 'now' },
    three: {
      state: threeState,
      draftedAt: threeState === 'done' ? draftedAtOf(STEP_THREE_PARTS) : null,
      parts: threeState === 'now' ? [...redrafts, ...STEP_THREE_PARTS] : STEP_THREE_PARTS,
    },
  }
}

// Works out the drafting state from what is saved now, step by step.
async function load(reference: string) {
  const inputs = await readInputs(reference)
  const states = partStates(inputs)
  const tasks = tasksOf(inputs, states)
  const tasksDone = tasks.every((t) => t.done)
  const plan = planOf(inputs, states, tasksDone)
  const state: DraftingState = {
    checkpoint: checkpointOf(inputs, states, plan, tasksDone),
    drafted: RUN_ORDER.filter((id) => states.get(id)!.drafted).length,
    parts: partsOf(inputs, states),
    tasks,
    steps: stepsOf(inputs, states, plan, tasksDone),
  }
  return { assessment: inputs.assessment, state }
}

/** Returns the report's drafting state (checkpoint, parts, tasks, steps); MarshBot reads this one. */
export async function draftingState(reference: string): Promise<DraftingState> {
  return (await load(reference)).state
}

/** Returns Generation's view for this viewer: the drafting state and whether they may start drafting. */
export async function getGeneration(reference: string, user: SessionUser): Promise<GenerationDto> {
  const { assessment, state } = await load(reference)
  // Only the assigned engineer, while not archived; an admin just watches (AC11).
  const canStart =
    String(assessment.engineer) === user.id &&
    permissionsFor(user.role).includes('reports:generate') &&
    !assessment.archivedAt
  return { ...state, canStart }
}
