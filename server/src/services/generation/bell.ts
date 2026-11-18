// The bell for background drafting (GN-13): tells the assessment's engineer a
// part is ready or was not drafted. Called by drafting-run.service.ts. Calls
// notification.service.ts (purpose `drafting_status`).
import { AssessmentModel } from '../../models/assessment.model'
import { clientNameOf } from '../client.service'
import { audienceOf, createNotification } from '../notification.service'

/**
 * Tells the assessment's current engineer, on the bell, with the assessment named
 * as site-walk notices name it (site-walk-notice.service.ts). Returns nothing and
 * never throws: the part is already saved, and without the catch a bell error
 * would fail the job and draft the part again.
 */
export async function tellBell(
  reference: string,
  status: 'ready' | 'failed',
  message: string,
  details?: string,
): Promise<void> {
  try {
    const assessment = await AssessmentModel.findOne(
      { reference },
      'engineer reportDueDate client site',
    )
      .populate<{ site: { name: string; client?: { name: string } | null } | null }>({
        path: 'site',
        select: 'name client',
        populate: { path: 'client', select: 'name' },
      })
      .lean()
    const to = assessment?.engineer && (await audienceOf(String(assessment.engineer)))
    if (!assessment || !to) return
    const context: Record<string, string> = {
      reference,
      status,
      client: clientNameOf(assessment.site, assessment.client),
      site: assessment.site?.name ?? '',
    }
    if (assessment.reportDueDate)
      context.reportDue = assessment.reportDueDate.toISOString().slice(0, 10)
    await createNotification({ purpose: 'drafting_status', message, details, ...to, context })
  } catch (error) {
    console.error('Could not create the drafting notification:', error)
  }
}
