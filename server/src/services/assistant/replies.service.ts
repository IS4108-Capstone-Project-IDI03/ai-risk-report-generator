// MarshBot's quick replies (AS-06 AC 4, AC 5, and the stale-export question):
// what each button changes, and the exchange kept on the brief.
// Called by routes/assistant.routes.ts. Calls brief.service.ts and recheck.service.ts.
import { z } from 'zod'
import type { Types } from 'mongoose'
import type { SessionUser } from '../auth.service'
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { dismiss, forEngineer, freshBrief, viewerOf } from './brief.service'
import { viewBrief, type StoredBrief } from './brief-view'
import { publishBriefChanged } from './bus'
import { dayOf, longDay, weekdayDay } from './dates'
import type { BriefFacts } from './phrases'
import { ASSISTANT } from './settings'
import type { AssistantBrief, QuickReply, ThreadEntry } from './types'

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
  ]),
  date: z.iso.date('Pick a valid day (YYYY-MM-DD).').optional(),
})

/**
 * Applies a quick reply (POST .../assistant/replies) and returns the brief
 * after it. Only a reply MarshBot is asking for now is taken. Throws
 * NotAssignedError, AssessmentArchivedError, ReplyNotAskedError, InvalidReplyError.
 */
export async function postReply(
  reference: string,
  user: SessionUser,
  input: z.infer<typeof replySchema>,
): Promise<AssistantBrief> {
  // a. The question asking for this reply, as the engineer sees it now.
  const assessment = await forEngineer(reference, user)
  const viewer = await viewerOf(assessment._id, user, 'engineer')
  const brief = await freshBrief(reference)
  const question = viewBrief(brief, viewer).messages.find((m) =>
    m.parts.some((p) => p.type === 'replies' && p.replies.some((r) => r.id === input.replyId)),
  )
  if (!question) throw new ReplyNotAskedError()
  const reply = question.parts
    .flatMap((p) => (p.type === 'replies' ? p.replies : []))
    .find((r) => r.id === input.replyId)!

  // b. What the reply changes, and MarshBot's answer.
  const { label, answer } = await applyReply(assessment._id, user, reply, input.date, brief)

  // c. The exchange, kept on the brief; then the brief after it.
  const at = new Date().toISOString()
  const said: ThreadEntry[] = [
    { who: 'bot', text: question.text, at, tone: 'question' },
    { who: 'engineer', text: label, at, tone: 'normal' },
    ...(answer ? [{ who: 'bot' as const, text: answer, at, tone: 'success' as const }] : []),
  ]
  await AssistantBriefModel.updateOne(
    { _id: brief._id },
    { $push: { thread: { $each: said, $slice: -ASSISTANT.keepThread } } },
  )
  const after = await freshBrief(reference)
  publishBriefChanged(reference, after.updatedAt.toISOString())
  return viewBrief(after, await viewerOf(assessment._id, user, 'engineer'))
}

// Saves what one reply changes; returns the engineer's words and MarshBot's answer.
async function applyReply(
  assessment: Types.ObjectId,
  user: SessionUser,
  reply: QuickReply,
  date: string | undefined,
  brief: StoredBrief,
): Promise<{ label: string; answer: string | null }> {
  const f = brief.facts as BriefFacts
  const stale = brief.items.find((i) => i.kind === 'stale-export' && !i.resolvedAt)
  const viewer = (update: object) =>
    AssistantViewerModel.updateOne({ assessment, user: user.id }, update, { upsert: true })
  switch (reply.id) {
    case 'nothing-more':
      await AssessmentModel.updateOne(
        { _id: assessment },
        { $set: { setupConfirmedAt: new Date() } },
      )
      return { label: reply.label, answer: "Thanks. I've moved this on to Prepare." }
    case 'ready-to-generate':
      await AssessmentModel.updateOne(
        { _id: assessment },
        { $set: { readyToGenerateAt: new Date() }, $unset: { anotherVisit: 1 } },
      )
      return { label: reply.label, answer: "Great. I've moved this on to Ready for generation." }
    case 'another-visit': {
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
      return {
        label: `I need another visit on ${weekdayDay(date)}`,
        answer: `Done. The survey now ends on ${longDay(date)}, and I'll keep ${f.site} in Capture until then. I won't raise any capture gaps in the meantime. Add whatever you gather on the day.`,
      }
    }
    case 'export-again':
      await viewer({ $set: { exportAgain: stale?.fingerprint ?? null } })
      return { label: reply.label, answer: null }
    case 'not-now':
      if (stale) await dismiss(assessment, user, stale.id, stale.fingerprint)
      return { label: reply.label, answer: "No problem. I'll ask again if anything else changes." }
  }
}
