// "Ask again" on a filled knowledge request (CB-07): the question waits here until MarshBot's
// chat box can take it (components/QuestionFromLink.tsx). Set by notifications/openSubject.ts.
// Held in memory, not the URL: the app rewrites the URL when it changes screen, which lost it.
const QUEUED = 'marshbot-question-queued'
let pending: string | null = null

/** Queues a question for the chat box, and tells an open chat to take it. */
export function queueQuestion(question: string) {
  pending = question
  window.dispatchEvent(new Event(QUEUED))
}

/** Returns the queued question once (then null). */
export function takeQuestion(): string | null {
  const question = pending
  pending = null
  return question
}

export const QUESTION_QUEUED = QUEUED
