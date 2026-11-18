// Background drafting (GN-13): starting a drafting run, drafting one part again
// from Review, the `drafting` queue's worker, settling a run, and restart
// recovery. Each job calls the same drafting function the old routes call,
// unchanged. Called by routes/generation.routes.ts, routes/assessment.routes.ts
// and report-document.service.ts (the guards) and index.ts (resume). Calls the
// review-decision, OFI and summary services, the bell (bell.ts) and the push
// channel (assistant/bus.ts).
import { DraftingRunModel, type IDraftingRun, type IPartJob } from '../../models/drafting-run.model'
import { NotAssignedError } from '../assessment.service'
import { queueAssessmentCheck } from '../assistant/check-queue.service'
import { publishDrafting } from '../assistant/bus'
import type { SessionUser } from '../auth.service'
import { AssessmentArchivedError } from '../capture-session.service'
import { defineQueue, retryJobId, type JobContext } from '../job-queue.service'
import { isDuplicateKeyError } from '../mongo-errors'
import { listObservations } from '../observation.service'
import { draftOfis } from '../ofi.service'
import { RagServiceError } from '../rag.service'
import {
  draftSection,
  NotDraftedError,
  regenerateSection,
  ReplacementPendingError,
} from '../review-decision.service'
import {
  assessmentToDraft,
  InsufficientEvidenceError,
  MissingFiguresError,
  sectionDrafts,
  TranscriptionInProgressError,
} from '../section.service'
import { draftSummary, IncompleteSectionsError } from '../summary.service'
import { tellBell } from './bell'
import {
  draftingState,
  evidenceFingerprint,
  getGeneration,
  isRunning,
  onInsert,
  RUNNING,
} from './generation.service'
import { RUN_ORDER, type GenerationDto } from './types'
import { sectionList } from './words'

export class DraftingRunActiveError extends Error {
  constructor() {
    super('Drafting is already under way. It carries on in the background.')
    this.name = 'DraftingRunActiveError'
  }
}
export class NothingToDraftError extends Error {
  constructor() {
    super('There is nothing to draft right now.')
    this.name = 'NothingToDraftError'
  }
}
// The part has a background job queued or drafting (the guard, rule 6 of the Architecture).
export class PartBusyError extends Error {
  constructor(partId: string) {
    super(`Section ${partId} is being drafted in the background. Try again once it is ready.`)
    this.name = 'PartBusyError'
  }
}
// A Review request for a part of the drafting run still going (finished or not).
export class PartInRunError extends Error {
  constructor() {
    super('Drafting is still under way. Try again when it finishes.')
    this.name = 'PartInRunError'
  }
}
// A review decision on a section whose saved draft is being redrafted: the
// decision would stay on the draft being replaced and be lost from the report.
export class SectionRedraftingError extends Error {
  constructor(sectionId: string) {
    super(`Section ${sectionId} is being redrafted. You can review it again when it's ready.`)
    this.name = 'SectionRedraftingError'
  }
}
export class UnknownPartError extends Error {
  constructor(partId: string) {
    super(`Section ${partId} is not one of the report's drafted sections (2 to 12).`)
    this.name = 'UnknownPartError'
  }
}

type DraftingJob = { reference: string; partId: string }

// shortcut: 3 at a time is across all assessments, not per assessment; give each
// assessment its own limit if several engineers draft at once and wait on each other.
// Three attempts is the first try and two retries (AC7), 5 s backoff growing each time.
/** The `drafting` queue; exported so tests can make adding a job fail. */
export const draftingQueue = defineQueue<DraftingJob>(
  'drafting',
  { concurrency: 3, attempts: 3, backoffMs: 5000 },
  (job, context) => runPart(job, context),
)

const NOT_QUEUED = 'Drafting could not be queued. Try again.'

// Queues a part's job and returns true; if the queue is down (Redis not
// answering), marks the part failed with a plain reason and returns false, so
// a run still closes and Try again works instead of "Drafting" for ever. One id
// per request of a part (its requestedAt), so a later request is never dropped
// as a duplicate of a job BullMQ is still finishing; a re-queue (`retry`) gets
// a fresh one (retryJobId), as BullMQ ignores an add for an id it still holds.
async function queuePart(reference: string, partId: string, requestedAt: Date, retry = false) {
  const jobId = `drafting-${reference}-${partId}-${new Date(requestedAt).getTime()}`
  try {
    await draftingQueue.add(retry ? retryJobId(jobId) : jobId, { reference, partId })
    return true
  } catch (error) {
    console.error(`Queueing Section ${partId} of ${reference} failed:`, error)
    const path = `parts.${partId}`
    const failed = await DraftingRunModel.updateOne(
      { reference, [`${path}.status`]: 'queued' },
      {
        $set: {
          [`${path}.status`]: 'failed',
          [`${path}.error`]: NOT_QUEUED,
          [`${path}.finishedAt`]: new Date(),
        },
      },
    )
    if (failed.modifiedCount)
      await tellBell(reference, 'failed', `Section ${partId} was not drafted.`, NOT_QUEUED)
    return false
  }
}

// A fresh job for a part, run as `user`.
function newJob(
  user: SessionUser,
  action: IPartJob['action'],
  instruction: string | null,
  at: Date,
): IPartJob {
  return {
    status: 'queued',
    action,
    instruction,
    attempts: 0,
    error: null,
    requestedBy: { id: user.id, role: user.role, name: user.name },
    requestedAt: at,
    finishedAt: null,
  }
}

const OFFERS_A_RUN = ['ready', 'failed', 'out_of_date']

/**
 * Starts the drafting run the checkpoint offers and returns Generation's state
 * with it queued. Only the assigned engineer; one run per assessment at a time.
 */
export async function startDraftingRun(
  reference: string,
  user: SessionUser,
): Promise<GenerationDto> {
  // a. Only the assigned engineer, while the assessment is not archived.
  const assessment = await assessmentToDraft(reference, user)

  // b. The run drafts what the checkpoint offers, in its order.
  const { checkpoint } = await draftingState(reference)
  if (checkpoint.kind === 'drafting') throw new DraftingRunActiveError()
  if (!OFFERS_A_RUN.includes(checkpoint.kind) || !('parts' in checkpoint))
    throw new NothingToDraftError()
  const parts = checkpoint.parts
  if (!parts.length) throw new NothingToDraftError()

  // c. Claimed in one write: it matches only with no run going and none of the
  // parts busy, so of two presses at once one wins. The loser's upsert then
  // clashes on the unique assessment and is refused.
  const now = new Date()
  const job = newJob(user, 'draft', null, now)
  try {
    await DraftingRunModel.findOneAndUpdate(
      {
        assessment: assessment._id,
        $or: [{ run: null }, { 'run.finishedAt': { $ne: null } }],
        ...Object.fromEntries(parts.map((id) => [`parts.${id}.status`, { $nin: RUNNING }])),
      },
      {
        $set: {
          run: {
            parts,
            startedBy: { id: user.id, name: user.name },
            startedAt: now,
            finishedAt: null,
          },
          ...Object.fromEntries(parts.map((id) => [`parts.${id}`, job])),
        },
        $setOnInsert: onInsert(assessment, now),
      },
      { upsert: true },
    )
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new DraftingRunActiveError()
    throw error
  }

  // d. One job per part, in order; one the queue refuses is failed and the
  // others carry on. Section 2 waits: settleRun queues it once the others are
  // done (at once, when it is the only part), and closes a run none of whose
  // parts could be queued.
  for (const id of parts) if (id !== '2') await queuePart(reference, id, now)
  await settleRun(reference)
  publishDrafting(reference)
  return getGeneration(reference, user)
}

/**
 * Drafts one part again in the background, from Review, and returns Generation's
 * state with it queued: Redraft for Sections 2 and 3, Regenerate (a replacement,
 * with the instruction) for Sections 4 to 12. Not part of a drafting run.
 */
export async function draftPartFromReview(
  reference: string,
  partId: string,
  instruction: string | null,
  user: SessionUser,
): Promise<GenerationDto> {
  if (!RUN_ORDER.includes(partId)) throw new UnknownPartError(partId)
  // a. Only the assigned engineer, while not archived.
  const assessment = await assessmentToDraft(reference, user)
  const action = partId === '2' || partId === '3' ? 'draft' : 'regenerate'

  // b. Regenerate's own refusals, checked now so the engineer hears at once.
  if (action === 'regenerate') {
    const drafts = (await sectionDrafts(assessment._id)).get(partId)
    if (!drafts?.saved) throw new NotDraftedError(partId)
    if (drafts.replacement) throw new ReplacementPendingError()
  }

  // c. Claimed in one write, so a run and a Review request never draft one part
  // at once. A part of the run still going is refused even once it has
  // finished: the run would otherwise wait for it, and the bell never say it.
  const now = new Date()
  try {
    await DraftingRunModel.findOneAndUpdate(
      {
        assessment: assessment._id,
        [`parts.${partId}.status`]: { $nin: RUNNING },
        $nor: [{ 'run.finishedAt': null, 'run.parts': partId }],
      },
      {
        $set: {
          [`parts.${partId}`]: newJob(
            user,
            action,
            action === 'regenerate' ? instruction : null,
            now,
          ),
        },
        $setOnInsert: onInsert(assessment, now),
      },
      { upsert: true },
    )
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    const inRun = await DraftingRunModel.exists({
      assessment: assessment._id,
      'run.finishedAt': null,
      'run.parts': partId,
    })
    throw inRun ? new PartInRunError() : new PartBusyError(partId)
  }
  await queuePart(reference, partId, now)
  publishDrafting(reference)
  return getGeneration(reference, user)
}

/** Throws PartBusyError when the part has a background job queued or drafting; else returns nothing. */
// shortcut: checked before the old synchronous routes draft, not claimed, so a
// run started during that request's AI call can still overlap it; claim the part
// there too if the old routes stay in use.
export async function assertPartIdle(reference: string, partId: string): Promise<void> {
  if (await DraftingRunModel.exists({ reference, [`parts.${partId}.status`]: { $in: RUNNING } }))
    throw new PartBusyError(partId)
}

/**
 * Throws SectionRedraftingError while one of Sections 4 to 12 has a direct
 * redraft (action `draft`) queued or drafting; else returns nothing. Called
 * before every review decision on the section: draftSection reads the decisions
 * before its AI call and carries them onto the new draft after it, so one made
 * in between would be lost. A regenerate doesn't block: its replacement waits
 * beside the saved draft.
 */
export async function assertNotRedrafting(reference: string, sectionId: string): Promise<void> {
  if (!RUN_ORDER.includes(sectionId) || sectionId === '2' || sectionId === '3') return
  const path = `parts.${sectionId}`
  if (
    await DraftingRunModel.exists({
      reference,
      [`${path}.status`]: { $in: RUNNING },
      [`${path}.action`]: 'draft',
    })
  )
    throw new SectionRedraftingError(sectionId)
}

// Errors whose message is already plain English for the engineer.
const PLAIN_ERRORS = [
  RagServiceError,
  InsufficientEvidenceError,
  MissingFiguresError,
  TranscriptionInProgressError,
  IncompleteSectionsError,
  NotAssignedError,
  AssessmentArchivedError,
  NotDraftedError,
  ReplacementPendingError,
]
const failureReason = (error: unknown) =>
  PLAIN_ERRORS.some((E) => error instanceof E)
    ? (error as Error).message
    : 'Drafting failed. Try again.'

// Calls the same drafting function as before GN-13, as the engineer who asked.
// Returns Section 3's evidence fingerprint, else null.
async function draftWith(reference: string, partId: string, job: IPartJob) {
  const user = job.requestedBy as SessionUser
  if (partId === '3') {
    // Taken before drafting, so an observation changed meanwhile shows Section 3 out of date.
    const fingerprint = evidenceFingerprint(await listObservations(reference))
    await draftOfis(reference, user)
    return fingerprint
  }
  if (partId === '2') await draftSummary(reference, user)
  else if (job.action === 'regenerate')
    await regenerateSection(reference, partId, job.instruction, user)
  else await draftSection(reference, partId, user)
  return null
}

// The `drafting` queue's worker: drafts one part. A failure throws so the queue
// retries it; on the last try the part is marked failed and the bell told.
async function runPart({ reference, partId }: DraftingJob, context: JobContext) {
  const path = `parts.${partId}`
  // a. Claim it: only a queued part is drafted, so a duplicate job drafts nothing.
  const record = await DraftingRunModel.findOneAndUpdate(
    { reference, [`${path}.status`]: 'queued' },
    { $set: { [`${path}.status`]: 'drafting' } },
    { returnDocument: 'after' },
  ).lean<IDraftingRun>()
  if (!record) return
  const job = record.parts![partId]
  const run = record.run
  const inRun = !!run && !run.finishedAt && run.parts.includes(partId)
  publishDrafting(reference)

  // b. Draft it. Only the drafting call is tried: a failed status write after
  // it must not re-queue a part already saved, or the retry pays for it twice.
  let drafted = false
  let fingerprint: string | null = null
  try {
    fingerprint = await draftWith(reference, partId, job)
    drafted = true
  } catch (error) {
    // Before the last try: back in the queue, and BullMQ retries after the backoff.
    if (!context.isLastAttempt) {
      await DraftingRunModel.updateOne(
        { reference, [`${path}.status`]: 'drafting' },
        { $set: { [`${path}.status`]: 'queued' }, $inc: { [`${path}.attempts`]: 1 } },
      )
      publishDrafting(reference)
      throw error
    }
    console.error(`Drafting Section ${partId} of ${reference} failed:`, error)
    const reason = failureReason(error)
    await DraftingRunModel.updateOne(
      { reference, [`${path}.status`]: 'drafting' },
      {
        $set: {
          [`${path}.status`]: 'failed',
          [`${path}.error`]: reason,
          [`${path}.finishedAt`]: new Date(),
        },
        $inc: { [`${path}.attempts`]: 1 },
      },
    )
    await tellBell(reference, 'failed', `Section ${partId} was not drafted.`, reason)
  }

  // c. Drafted: mark it done. If this write throws, BullMQ retries a job whose
  // claim (queued only) then drafts nothing.
  if (drafted) {
    const finishedAt = new Date()
    await DraftingRunModel.updateOne(
      { reference, [`${path}.status`]: 'drafting' },
      {
        $set: {
          [`${path}.status`]: 'done',
          [`${path}.error`]: null,
          [`${path}.finishedAt`]: finishedAt,
          ...(fingerprint && { ofiEvidence: fingerprint, ofiEvidenceAt: finishedAt }),
        },
      },
    )
    if (!inRun) await tellBell(reference, 'ready', `Your new draft of Section ${partId} is ready.`)
  }

  // d. Tell the open page and MarshBot, which doesn't see a worker's writes.
  publishDrafting(reference)
  queueAssessmentCheck(reference)
  if (inRun) await settleRun(reference)
}

// Moves a drafting run on once its other parts have finished. Section 2 is
// queued then if none failed and the engineer's tasks are still done, or else
// dropped (left not drafted), as it would summarise a gap. Once every part has
// finished, the run is closed and the bell says which parts are ready. Safe to
// call twice: each step is claimed. Never throws for the queue, or BullMQ would
// retry a part already done and the run would never close.
async function settleRun(reference: string) {
  const record = await DraftingRunModel.findOne({ reference }).lean<IDraftingRun>()
  const run = record?.run
  if (!record || !run || run.finishedAt) return
  const status = (id: string) => record.parts?.[id]?.status
  const others = run.parts.filter((id) => id !== '2')
  if (others.some((id) => isRunning(record.parts?.[id]))) return

  if (run.parts.includes('2') && isRunning(record.parts?.['2'])) {
    if (status('2') === 'drafting') return
    // A second call adds a second job (a fresh id); the claim in runPart makes it draft nothing.
    if (
      !others.some((id) => status(id) === 'failed') &&
      (await tasksStillDone(reference)) &&
      (await queuePart(reference, '2', record.parts!['2'].requestedAt, true))
    )
      return
    // Not queued: dropped, unless the queue refused it, which left it failed for Try again.
    await DraftingRunModel.updateOne(
      { reference, 'parts.2.status': 'queued' },
      { $unset: { 'parts.2': 1 } },
    )
  }

  // Matched on its start too, so a newer run is never closed by an old one's job.
  const closed = await DraftingRunModel.updateOne(
    { reference, 'run.startedAt': run.startedAt, 'run.finishedAt': null },
    { $set: { 'run.finishedAt': new Date() } },
  )
  if (!closed.modifiedCount) return
  const ready = run.parts.filter((id) => status(id) === 'done')
  if (ready.length)
    await tellBell(reference, 'ready', `Your draft of ${sectionList(ready)} is ready.`)
  publishDrafting(reference)
  queueAssessmentCheck(reference)
}

// Whether the engineer's three tasks are still done, read again just before
// Section 2 is queued: a redraft of Section 3 that suggested OFIs where there
// were none leaves one to accept, and Section 2 would then fail 3 times. If
// the state can't be read (S4 down), Section 2 is queued and fails on its own.
async function tasksStillDone(reference: string) {
  try {
    return (await draftingState(reference)).tasks.every((t) => t.done)
  } catch (error) {
    console.error(`Checking the tasks of ${reference} before Section 2 failed:`, error)
    return true
  }
}

/**
 * Re-queues every part left queued or drafting when the gateway stopped, and
 * moves open runs on; returns once queued. Called before the workers start
 * (index.ts), so no job is picked up and then reset under it.
 */
export async function resumeDraftingRuns(): Promise<void> {
  const records = await DraftingRunModel.find({
    $or: [
      { run: { $ne: null }, 'run.finishedAt': null },
      ...RUN_ORDER.map((id) => ({ [`parts.${id}.status`]: { $in: RUNNING } })),
    ],
  }).lean<IDraftingRun[]>()
  for (const record of records) {
    const run = record.run && !record.run.finishedAt ? record.run : null
    for (const id of RUN_ORDER) {
      const job = record.parts?.[id]
      if (!isRunning(job)) continue
      // Section 2 of an open run waits for the others; settleRun queues it.
      if (id === '2' && run?.parts.includes('2') && job!.status === 'queued') continue
      // A part cut off mid-draft is drafted again from the start, under a fresh
      // job id: BullMQ may still hold the old one and would ignore the add.
      await DraftingRunModel.updateOne(
        { reference: record.reference, [`parts.${id}.status`]: 'drafting' },
        { $set: { [`parts.${id}.status`]: 'queued' } },
      )
      await queuePart(record.reference, id, job!.requestedAt, true)
    }
    if (run) await settleRun(record.reference)
  }
}
