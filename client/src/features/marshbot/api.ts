// MarshBot's gateway calls (AS-06): read the conversation thread, answer a reply, and listen for
// "the thread changed" pushes. Called by useThread.ts. Calls the routes in
// server/src/routes/assistant.routes.ts and assistant-events.routes.ts.
import { useEffect, useRef } from 'react'
import { request } from '../assessments/api'
import type { AssistantThread, Reply } from './types'

const assistantPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/assistant`

/** Returns the assessment's conversation thread; the gateway records this as the viewer's open. */
export async function getThread(reference: string, signal?: AbortSignal): Promise<AssistantThread> {
  return (await request<AssistantThread>('GET', assistantPath(reference), undefined, signal)).data
}

/** Returns the thread after the engineer's reply (with the picked day for another visit).
    `lastTurnId` is the newest turn on screen: a reply pressed again elsewhere is refused (409). */
export async function sendReply(
  reference: string,
  replyId: Reply['id'],
  date?: string,
  lastTurnId?: string,
): Promise<AssistantThread> {
  const body = { replyId, ...(date && { date }), ...(lastTurnId && { lastTurnId }) }
  return (await request<AssistantThread>('POST', `${assistantPath(reference)}/replies`, body)).data
}

/** Calls `onChange` whenever the gateway pushes that the thread changed, and after every
    reconnect, since a change made while the stream was down sent no push. The first connect
    is skipped: the thread was just read. No polling. */
export function useThreadStream(reference: string, onChange: () => void) {
  // Kept in a ref so a new callback doesn't reopen the stream.
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    // jsdom and very old browsers have no EventSource: the Overview then just doesn't update live.
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(`${assistantPath(reference)}/events`)
    let connected = false
    source.addEventListener('brief', () => latest.current())
    // Without the skip, opening the Overview would read (and re-check) the thread twice.
    source.addEventListener('open', () => {
      if (connected) latest.current()
      connected = true
    })
    // EventSource retries a dropped stream by itself. A refused one (401 once the session
    // is gone) is CLOSED for good: stop, so it never hammers the gateway.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close()
    }
    return () => source.close()
  }, [reference])
}
