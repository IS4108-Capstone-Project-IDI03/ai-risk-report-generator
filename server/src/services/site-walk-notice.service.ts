// Tells the engineer about a site walk (F-10): its proposal is ready to review, or it
// failed and needs a retry. Called by site-walk-proposal.service.ts and
// site-walk.service.ts. Calls notification.service.ts.
//
// Both go to the assessment's CURRENT engineer, not the engineer who started the
// walk: an admin may have taken the assessment over since. Both are addressed by
// that person's current role; a hardcoded engineer role would hide the item from
// an admin who holds the assessment.
import type { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { clientNameOf } from './client.service'
import { audienceOf, createNotification } from './notification.service'

// Which walk it is about and where, as the Inbox row shows it. Every value is a
// string (a notification's context is a string map).
// shortcut: `reportDue` is a snapshot from the time the item was made, as for an
// assigned assessment; upgrade if the row must follow a later change of date.
async function walkContext(walkId: Types.ObjectId, assessmentId: Types.ObjectId) {
  const assessment = await AssessmentModel.findById(
    assessmentId,
    'reference engineer reportDueDate client site',
  )
    .populate<{ site: { name: string; client?: { name: string } | null } | null }>({
      path: 'site',
      select: 'name client',
      populate: { path: 'client', select: 'name' },
    })
    .lean()
  if (!assessment?.engineer) return null
  const context: Record<string, string> = {
    reference: assessment.reference,
    walkId: String(walkId),
    client: clientNameOf(assessment.site, assessment.client),
    site: assessment.site?.name ?? '',
  }
  if (assessment.reportDueDate)
    context.reportDue = assessment.reportDueDate.toISOString().slice(0, 10)
  return { context, engineer: String(assessment.engineer), site: context.site }
}

/**
 * Tells the assessment's current engineer a walk's proposal is ready. Keyed by
 * the walk, so a resend after a crash adds none. Throws when the write fails, so
 * the queue sends it again (the walk is marked notified only after).
 */
export async function notifyReady(walk: { _id: Types.ObjectId; assessment: Types.ObjectId }) {
  const found = await walkContext(walk._id, walk.assessment)
  const to = found && (await audienceOf(found.engineer))
  if (found && to)
    await createNotification({
      purpose: 'site_walk_ready',
      message: `Review site walk: ${found.site}`,
      ...to,
      context: found.context,
    })
  await SiteWalkModel.updateOne({ _id: walk._id }, { notified: true })
}

/**
 * Tells the assessment's current engineer a walk failed, so they retry it. Keyed
 * by the walk and its retry count: a retry that fails again tells them again, and
 * a failure delivered twice does not. Never throws: the walk is already marked
 * failed, and without the catch a notification error would hide the real failure.
 */
export async function notifyFailed(walkId: Types.ObjectId | string) {
  try {
    const walk = await SiteWalkModel.findById(walkId, 'assessment error retries').lean()
    if (!walk) return
    const found = await walkContext(walk._id, walk.assessment)
    const to = found && (await audienceOf(found.engineer))
    if (!found || !to) return
    // The retry count tells one failure of a walk from the next. Absent for the
    // first try, as for a document's retry.
    if (walk.retries) found.context.attempt = String(walk.retries)
    await createNotification({
      purpose: 'site_walk_failed',
      message: `Retry site walk: ${found.site}`,
      details: walk.error,
      ...to,
      context: found.context,
    })
  } catch (error) {
    console.error('Could not create the site walk failure notification:', error)
  }
}
