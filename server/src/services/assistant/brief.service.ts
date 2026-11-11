// MarshBot's API (AS-06): the brief for whoever opens the Overview, the
// engineer's dismissals and activity, and the export hook. Quick replies are
// in replies.service.ts, which shares the helpers here.
// Called by routes/assistant.routes.ts and routes/assessment.routes.ts (export).
// Calls recheck.service.ts, coverage.service.ts and brief-view.ts.
import { z } from 'zod'
import type { Types } from 'mongoose'
import type { SessionUser } from '../auth.service'
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { NotAssignedError, opensAssessment } from '../assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from '../capture-session.service'
import { CannotOpenAssessmentError } from '../comment.service'
import { activitySchema, recordActivity, type ActivityInput } from './activity'
import { viewBrief, type StoredBrief, type Viewer } from './brief-view'
import { publishBriefChanged } from './bus'
import { startCoverageIfDue } from './coverage.service'
import { queueAssessmentCheck } from './check-queue.service'
import { refreshBrief } from './recheck.service'
import { ASSISTANT } from './settings'
import type { AssistantBrief } from './types'

export { activitySchema }

export class ItemNotFoundError extends Error {
  constructor() {
    super('MarshBot is not showing that item any more.')
    this.name = 'ItemNotFoundError'
  }
}
// Fix now items can't be dismissed (AC 6), 409.
export class FixNowItemError extends Error {
  constructor() {
    super("Fix now items can't be dismissed.")
    this.name = 'FixNowItemError'
  }
}

export const dismissalSchema = z.object({ itemId: z.string().min(1).max(300) })

/** Returns the assessment's id, engineer and archivedAt; throws AssessmentNotFoundError. */
export async function found(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return assessment
}

/**
 * Returns the brief, re-checked, and worded when the assigned engineer has it
 * open (`wording`); throws AssessmentNotFoundError.
 */
export async function freshBrief(reference: string, wording = true): Promise<StoredBrief> {
  const brief = await refreshBrief(reference, { wording })
  if (!brief) throw new AssessmentNotFoundError(reference)
  return brief
}

// The viewer's state, recording this open. Opens close together are one visit,
// so a pushed refresh keeps "since you were last here".
async function recordOpen(assessment: Types.ObjectId, user: SessionUser, now: Date) {
  const v = await AssistantViewerModel.findOne({ assessment, user: user.id }).lean()
  const sameVisit = !!v?.openedAt && now.getTime() - v.openedAt.getTime() < ASSISTANT.sameVisitMs
  const lastOpenedAt = sameVisit ? (v?.lastOpenedAt ?? null) : (v?.openedAt ?? null)
  await AssistantViewerModel.updateOne(
    { assessment, user: user.id },
    { $set: { openedAt: now, lastOpenedAt } },
    { upsert: true },
  )
  return { dismissed: v?.dismissed ?? [], exportAgain: v?.exportAgain ?? null, lastOpenedAt }
}

/** Returns the viewer's state without recording an open. */
export async function viewerOf(
  assessment: Types.ObjectId,
  user: SessionUser,
  role: Viewer['role'],
): Promise<Viewer> {
  const v = await AssistantViewerModel.findOne({ assessment, user: user.id }).lean()
  return {
    role,
    name: user.name,
    lastOpenedAt: v?.lastOpenedAt ?? null,
    dismissed: v?.dismissed ?? [],
    exportAgain: v?.exportAgain ?? null,
  }
}

/**
 * Returns the brief for GET .../assistant: re-checked, as this viewer sees it.
 * Records the open, and starts the coverage check if due (engineer only).
 * Throws AssessmentNotFoundError, CannotOpenAssessmentError.
 */
export async function getBrief(reference: string, user: SessionUser): Promise<AssistantBrief> {
  const assessment = await found(reference)
  if (!opensAssessment(user, assessment.engineer)) throw new CannotOpenAssessmentError()
  const role = String(assessment.engineer) === user.id ? 'engineer' : 'admin'
  const now = new Date()
  // The open first, so the wording asked for below is for the messages this visit shows.
  const viewer = await recordOpen(assessment._id, user, now)
  // Only the engineer's own open pays for wording: an admin never sees it (AC 11).
  const brief = await freshBrief(reference, role === 'engineer')
  if (role === 'engineer' && !assessment.archivedAt && (await startCoverageIfDue(brief, now)))
    brief.coverage = { ...brief.coverage, status: 'running' }
  return viewBrief(brief, { role, name: user.name, ...viewer }, now)
}

/** Returns the assessment for a change by its assigned engineer; throws NotAssignedError, AssessmentArchivedError. */
export async function forEngineer(reference: string, user: SessionUser) {
  const assessment = await found(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  return assessment
}

/** Records one dismissal, replacing an earlier one of the same item; returns nothing. */
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
 * Hides an item from this engineer until its fingerprint changes (AC 6);
 * returns nothing. Throws NotAssignedError, ItemNotFoundError, FixNowItemError.
 */
export async function dismissItem(
  reference: string,
  user: SessionUser,
  itemId: string,
): Promise<void> {
  const assessment = await found(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  const brief = await AssistantBriefModel.findOne({ assessment: assessment._id }, 'items').lean()
  const item = brief?.items.find((i) => i.id === itemId && !i.resolvedAt)
  if (!item) throw new ItemNotFoundError()
  if (item.weight === 'fix_now') throw new FixNowItemError()
  await dismiss(assessment._id, user, item.id, item.fingerprint)
  publishBriefChanged(reference, new Date().toISOString())
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
