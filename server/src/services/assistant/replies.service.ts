// MarshBot's replies (AS-06 AC 4, AC 5, round 5): what each tray button
// changes, then the engineer's bubble and MarshBot's answer added to the
// conversation. Called by routes/assistant.routes.ts. Calls brief.service.ts,
// recheck.service.ts and thread.service.ts.
import { z } from 'zod'
import type { SessionUser } from '../auth.service'
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { dismiss, forEngineer, freshBrief } from './brief.service'
import { dayOf } from './dates'
import { engineerThread, type Loaded } from './thread.service'
import type { ThreadBrief } from './thread/types'
import type { AssistantThread, Reply } from './types'

// A reply MarshBot isn't asking for right now (409).
export class ReplyNotAskedError extends Error {
  constructor() {
    super('MarshBot is not asking that right now. Reload the Overview.')
    this.name = 'ReplyNotAskedError'
  }
}
// A reply missing what it needs, e.g. another visit without a day (400).
export class InvalidReplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidReplyError'
  }
}

// The body of POST .../assistant/replies.
export const replySchema = z.object({
  replyId: z.enum([
    'nothing-more',
    'ready-to-generate',
    'another-visit',
    'export-again',
    'not-now',
    'skip',
    'what-else',
    'generate-anyway',
  ]),
  date: z.iso.date('Pick a valid day (YYYY-MM-DD).').optional(),
})

/**
 * Applies a reply (POST .../assistant/replies) and returns the conversation
 * after it. Only a reply the tray offers now is taken. Throws
 * NotAssignedError, AssessmentArchivedError, ReplyNotAskedError, InvalidReplyError.
 */
export async function postReply(
  reference: string,
  user: SessionUser,
  input: z.infer<typeof replySchema>,
): Promise<AssistantThread> {
  const assessment = await forEngineer(reference, user)
  return engineerThread(
    reference,
    { type: 'reply', reply: input.replyId, date: input.date },
    {
      // Checked and applied while the thread is held, so two presses can't both land.
      prepare: async (offered, loaded) => {
        if (!offered.some((r) => r.id === input.replyId)) throw new ReplyNotAskedError()
        if (await applyReply(assessment._id, user, input.replyId, input.date, loaded))
          return (await freshBrief(reference)) as unknown as ThreadBrief
        return loaded.brief
      },
    },
  )
}

// Saves what one reply changes; returns whether it changed the assessment (so the brief is re-checked).
async function applyReply(
  assessment: Awaited<ReturnType<typeof forEngineer>>['_id'],
  user: SessionUser,
  reply: Reply['id'],
  date: string | undefined,
  loaded: Loaded,
): Promise<boolean> {
  const stale = loaded.brief.items.find((i) => i.kind === 'stale-export' && !i.resolvedAt)
  const viewer = (update: object) =>
    AssistantViewerModel.updateOne({ assessment, user: user.id }, update, { upsert: true })
  switch (reply) {
    case 'nothing-more':
      await AssessmentModel.updateOne(
        { _id: assessment },
        { $set: { setupConfirmedAt: new Date() } },
      )
      return true
    case 'ready-to-generate':
      await AssessmentModel.updateOne(
        { _id: assessment },
        { $set: { readyToGenerateAt: new Date() }, $unset: { anotherVisit: 1 } },
      )
      return true
    case 'another-visit':
      // Without this, the survey could end before today and the question would come straight back.
      if (!date) throw new InvalidReplyError('Pick the day of the visit.')
      if (date < dayOf(new Date()))
        throw new InvalidReplyError('Pick today or a later day for the visit.')
      await AssessmentModel.updateOne(
        { _id: assessment },
        {
          $set: { siteVisitEndDate: new Date(date), anotherVisit: new Date() },
          $unset: { readyToGenerateAt: 1 },
        },
      )
      return true
    case 'export-again':
      await viewer({ $set: { exportAgain: stale?.fingerprint ?? null } })
      loaded.viewer.exportAgain = stale?.fingerprint ?? null
      return false
    case 'not-now':
      if (stale) {
        await dismiss(assessment, user, stale.id, stale.fingerprint)
        loaded.viewer.dismissed.push({ itemId: stale.id, fingerprint: stale.fingerprint })
      }
      return false
    default:
      // 'skip', 'what-else' and 'generate-anyway' only move the conversation on.
      return false
  }
}
