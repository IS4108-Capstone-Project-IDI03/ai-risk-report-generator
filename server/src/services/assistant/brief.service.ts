// MarshBot's API (AS-06): the conversation for whoever opens the Overview, the
// engineer's activity, and the export hook. Replies are in
// replies.service.ts, which shares the helpers here.
// Called by routes/assistant.routes.ts and routes/assessment.routes.ts (export).
// Calls recheck.service.ts, coverage.service.ts and thread.service.ts.
import type { Types } from 'mongoose'
import type { SessionUser } from '../auth.service'
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { NotAssignedError, opensAssessment } from '../assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from '../capture-session.service'
import { CannotOpenAssessmentError } from '../comment.service'
import { activitySchema, recordActivity, type ActivityInput } from './activity'
import { startCoverageIfDue } from './coverage.service'
import { queueAssessmentCheck } from './check-queue.service'
import { refreshBrief, type StoredBrief } from './recheck.service'
import { engineerThread } from './thread.service'
import { adminThread } from './thread/view'
import type { ThreadBrief } from './thread/types'
import type { AssistantThread } from './types'

export { activitySchema }

/** Returns the assessment's id, engineer and archivedAt; throws AssessmentNotFoundError. */
export async function found(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return assessment
}

/** Returns the brief, re-checked; throws AssessmentNotFoundError. */
export async function freshBrief(reference: string): Promise<StoredBrief> {
  const brief = await refreshBrief(reference)
  if (!brief) throw new AssessmentNotFoundError(reference)
  return brief
}

/**
 * Returns the conversation for GET .../assistant: re-checked, as this viewer
 * sees it. For the assigned engineer it records the open, starts the coverage
 * check if due, and moves the saved thread on (event 'open'); an admin gets a
 * view built on the fly and nothing is saved (AC 11).
 * Throws AssessmentNotFoundError, CannotOpenAssessmentError.
 */
export async function getThread(reference: string, user: SessionUser): Promise<AssistantThread> {
  const assessment = await found(reference)
  if (!opensAssessment(user, assessment.engineer)) throw new CannotOpenAssessmentError()
  const now = new Date()
  if (String(assessment.engineer) !== user.id)
    return adminThread((await freshBrief(reference)) as unknown as ThreadBrief, user.name, now)
  // The open first: a re-check moves the conversation on only for an Overview that is open.
  await AssistantViewerModel.updateOne(
    { assessment: assessment._id, user: user.id },
    { $set: { openedAt: now } },
    { upsert: true },
  )
  const brief = await freshBrief(reference)
  if (!assessment.archivedAt && (await startCoverageIfDue(brief, now)))
    brief.coverage = { ...brief.coverage, status: 'running' }
  return engineerThread(reference, { type: 'open' }, { brief: brief as unknown as ThreadBrief })
}

/** Returns the assessment for a change by its assigned engineer; throws NotAssignedError, AssessmentArchivedError. */
export async function forEngineer(reference: string, user: SessionUser) {
  const assessment = await found(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  return assessment
}

/** Records one dismissal ("Not now" on the stale export), replacing an earlier one of the same item; returns nothing. */
export async function dismiss(
  assessment: Types.ObjectId,
  user: SessionUser,
  itemId: string,
  fingerprint: string,
) {
  await AssistantViewerModel.updateOne(
    { assessment, user: user.id },
    { $pull: { dismissed: { itemId } } },
    { upsert: true },
  )
  await AssistantViewerModel.updateOne(
    { assessment, user: user.id },
    { $push: { dismissed: { itemId, fingerprint } } },
  )
}

/**
 * Adds the browser's activity counts (POST .../assistant/activity) for the
 * assigned engineer; returns nothing. An admin's are dropped (AC 11): nothing
 * of theirs is kept. Throws AssessmentNotFoundError, CannotOpenAssessmentError.
 */
export async function postActivity(
  reference: string,
  user: SessionUser,
  input: ActivityInput,
): Promise<void> {
  const assessment = await found(reference)
  if (!opensAssessment(user, assessment.engineer)) throw new CannotOpenAssessmentError()
  if (String(assessment.engineer) !== user.id || assessment.archivedAt) return
  await recordActivity(assessment._id, user.id, input)
  if (input.places.some((p) => p.place === 'review'))
    await AssistantViewerModel.updateOne(
      { assessment: assessment._id, user: user.id },
      { $set: { reviewOpenedAt: new Date() } },
      { upsert: true },
    )
}

/** Returns how many pages a PDF has, or null when it can't tell. */
export function pdfPageCount(pdf: Buffer): number | null {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length || null
}

/**
 * Saves a successful export's date and file on the assessment (the Exported
 * stage) and queues its re-check; returns nothing. Queued after the save, not
 * left to the export request's own: that one may run before this save lands,
 * and in the same 2-second window the two are one job.
 */
export async function recordExport(
  reference: string,
  fileName: string,
  pages: number | null,
): Promise<void> {
  await AssessmentModel.updateOne(
    { reference },
    { $set: { exportedAt: new Date(), exportFile: { fileName, pages } } },
  )
  queueAssessmentCheck(reference)
}
