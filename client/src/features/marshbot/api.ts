// MarshBot's gateway calls (AS-06): read the brief, answer a quick reply, dismiss an item,
// and listen for "the brief changed" pushes. Called by useBrief.ts. Calls the routes in
// server/src/routes/assistant.routes.ts and assistant-events.routes.ts.
import { useEffect, useRef } from 'react'
import { request } from '../assessments/api'
import type { AssistantBrief, QuickReply } from './types'

const assistantPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/assistant`

/** Returns the assessment's brief; the gateway records this as the viewer's open. */
export async function getBrief(reference: string, signal?: AbortSignal): Promise<AssistantBrief> {
  return (await request<AssistantBrief>('GET', assistantPath(reference), undefined, signal)).data
}

/** Returns the brief after the engineer's quick reply (with the picked day for another visit). */
export async function sendReply(
  reference: string,
  replyId: QuickReply['id'],
  date?: string,
): Promise<AssistantBrief> {
  const body = date ? { replyId, date } : { replyId }
  return (await request<AssistantBrief>('POST', `${assistantPath(reference)}/replies`, body)).data
}

/** Returns once the item is hidden for this viewer until what it is about changes. */
export async function dismissItem(reference: string, itemId: string): Promise<void> {
  await request<void>('POST', `${assistantPath(reference)}/dismissals`, { itemId })
}

/** Calls `onChange` whenever the gateway pushes that the brief changed, and each time the
    stream (re)connects, since a change made while it was down sent no push. No polling. */
export function useBriefStream(reference: string, onChange: () => void) {
  // Kept in a ref so a new callback doesn't reopen the stream.
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    // jsdom and very old browsers have no EventSource: the Overview then just doesn't update live.
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(`${assistantPath(reference)}/events`)
    source.addEventListener('brief', () => latest.current())
    // Fires on the first connect and after every automatic reconnect.
    source.addEventListener('open', () => latest.current())
    // EventSource retries a dropped stream by itself. A refused one (401 once the session
    // is gone) is CLOSED for good: stop, so it never hammers the gateway.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close()
    }
    return () => source.close()
  }, [reference])
}
