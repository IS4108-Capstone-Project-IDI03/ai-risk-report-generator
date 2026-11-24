// The assessment-check queue (AS-06): re-checks an assessment's MarshBot brief
// in the background after something changes. Called by the recheck middleware,
// background jobs as they finish, and a daily schedule. Calls recheck.service.ts.
import type { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { defineQueue } from '../job-queue.service'
import { NOT_PRACTICE } from '../practice/filter'

// Changes are gathered in 2-second windows. A window's job is held back until
// the window closes, so every change in it lands before the check reads
// anything; a change after that falls in the next window and gets its own job.
// Without the hold, a change made while its window's check was already running
// would share that job's id, be ignored as a duplicate, and never be checked.
const WINDOW_MS = 2000

type CheckJob = { reference: string } | { daily: true }

// Concurrency 4: recheck.service runs one check per assessment at a time, so
// checks of different assessments can share the workers without saving out of order.
const checkQueue = defineQueue<CheckJob>(
  'assessment-check',
  { concurrency: 4, attempts: 2, backoffMs: 5000 },
  async (job, { isLastAttempt }) => {
    if ('daily' in job) return queueDueAssessments()
    // Loaded here, not at the top: recheck.service reads observations and walks,
    // whose services queue checks from this file, which would be an import cycle.
    const { recheckAssessment } = await import('./recheck.service')
    try {
      await recheckAssessment(job.reference)
    } catch (error) {
      // Thrown before the last try, so BullMQ retries a passing outage; the last one is one log line.
      if (!isLastAttempt) throw error
      console.warn(
        `MarshBot re-check of ${job.reference} failed:`,
        error instanceof Error ? error.message : error,
      )
    }
  },
)

/** Queues a re-check of the assessment's brief; returns nothing and never throws. */
export function queueAssessmentCheck(reference: string): void {
  const now = Date.now()
  const window = Math.floor(now / WINDOW_MS)
  // Never awaited by the caller: a Redis outage must not fail the engineer's save.
  checkQueue
    .add(`as-check-${reference}-${window}`, { reference }, (window + 1) * WINDOW_MS - now)
    .catch((error: unknown) => console.error(`Queueing the check of ${reference} failed:`, error))
}

/** Queues a re-check of the assessment with this id; returns nothing and never throws. */
export function queueAssessmentCheckById(id: Types.ObjectId | string): void {
  AssessmentModel.findById(id, 'reference')
    .lean()
    .then((found) => found && queueAssessmentCheck(found.reference))
    .catch((error: unknown) => console.error('Finding the assessment to check failed:', error))
}

/** Returns the references the daily re-check queues: every open assessment, no practice one (F-12). */
export async function dueReferences(): Promise<string[]> {
  const open = await AssessmentModel.find(
    { archivedAt: { $exists: false }, stage: { $ne: 'exported' }, ...NOT_PRACTICE },
    'reference',
  ).lean()
  return open.map((a) => a.reference)
}

// Every open assessment, so date-based items (survey passed, report due or late)
// move on even when nobody changes anything that day.
async function queueDueAssessments() {
  for (const reference of await dueReferences()) queueAssessmentCheck(reference)
}

/** Schedules the daily re-check at 00:05 Singapore time (16:05 UTC); returns once Redis holds it. */
export const scheduleDailyAssessmentChecks = () =>
  checkQueue.schedule('assessment-check-daily', '5 16 * * *', { daily: true })
