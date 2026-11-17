// The open Overview's conversation thread (AS-06): read once per visit, read again on every
// push, and replaced by a reply's answer. Kept per assessment in a module cache, so leaving the
// tab and coming back shows the same thread at once, then reads it once more in the background.
// The cache empties on sign-out and when the session ends, so the next person never sees it.
// Called by screens/MarshBotOverview.tsx. Calls api.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../design-system'
import { GatewayError, SESSION_ENDED_EVENT } from '../assessments/api'
import { getThread, sendReply, useThreadStream } from './api'
import type { AssistantThread, Reply } from './types'

// The last thread seen per assessment reference, for the signed-in person only.
const cache = new Map<string, AssistantThread>()

/** Empties the thread cache; App.tsx calls it on sign-out. */
export function clearThreadCache() {
  cache.clear()
}
// A session that expired (any 401) empties it too. jsdom and the browser both have window.
if (typeof window !== 'undefined') window.addEventListener(SESSION_ENDED_EVENT, clearThreadCache)

export type ThreadState = {
  thread: AssistantThread | null
  failed: boolean
  // Reads the thread again after a failed first read.
  retry: () => void
  // Sends a reply and puts the answer on screen; resolves that thread, or null when the gateway
  // refused it (a toast says so, except for a reply no longer asked: answered elsewhere).
  reply: (replyId: Reply['id'], date?: string) => Promise<AssistantThread | null>
}

// A gateway without the thread answers something else: treat it as a failed read, not a crash.
const isThread = (t: AssistantThread | null | undefined): t is AssistantThread =>
  Array.isArray(t?.session?.turns)

// The gateway said no (signed out, not this viewer's, gone): what is cached must not stay up.
const refused = (error: unknown) =>
  error instanceof GatewayError && [401, 403, 404].includes(error.status ?? 0)

/** Returns the thread for `reference` (the cached one first), and the reply action. */
export function useThread(reference: string): ThreadState {
  const [thread, setThread] = useState<AssistantThread | null>(() => cache.get(reference) ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const shown = useRef(thread !== null)
  // Each read or reply takes a number when it starts; an answer from an older one than what is
  // on screen is dropped. Without this, a read sent before a reply but answered after it would
  // put the old turns back (the thread's updatedAt doesn't move for every reply).
  const issued = useRef(0)
  const applied = useRef(0)
  // One read at a time: 'again' asks for one more read once the running one ends.
  const reading = useRef<'idle' | 'busy' | 'again'>('idle')

  const take = useCallback(
    (next: AssistantThread, ticket: number) => {
      if (ticket < applied.current) return
      applied.current = ticket
      shown.current = true
      cache.set(reference, next)
      setThread(next)
    },
    [reference],
  )

  // Drops the thread from screen and cache and shows the failed state.
  const refuse = useCallback(() => {
    cache.delete(reference)
    shown.current = false
    setThread(null)
    setFailed(true)
  }, [reference])

  // A call while a read runs asks for one more read after it, so a burst of pushes costs two
  // reads, not one each. A failed read keeps what is on screen unless the gateway refused.
  const refresh = useCallback(
    function read() {
      if (reading.current !== 'idle') {
        reading.current = 'again'
        return
      }
      reading.current = 'busy'
      const ticket = ++issued.current
      getThread(reference)
        .then((t) => isThread(t) && take(t, ticket))
        .catch((error: unknown) => refused(error) && refuse())
        .finally(() => {
          const again = reading.current === 'again'
          reading.current = 'idle'
          if (again) read()
        })
    },
    [reference, take, refuse],
  )

  // a. The read on open: the first view of this assessment, or a background one behind the cache.
  useEffect(() => {
    const abort = new AbortController()
    reading.current = 'busy'
    const ticket = ++issued.current
    getThread(reference, abort.signal)
      .then((t) => {
        if (!isThread(t)) throw new Error('Not a thread')
        take(t, ticket)
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        // A cached thread stays up through a dropped connection, never through a refusal.
        if (refused(error)) refuse()
        else if (!shown.current) setFailed(true)
      })
      .finally(() => {
        if (abort.signal.aborted) return
        const again = reading.current === 'again'
        reading.current = 'idle'
        if (again) refresh()
      })
    return () => {
      abort.abort()
      reading.current = 'idle'
    }
  }, [reference, take, refuse, refresh, attempt])

  // b. Every push, and every reconnect of the stream, reads it again.
  useThreadStream(reference, refresh)

  const retry = () => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  const reply = async (replyId: Reply['id'], date?: string) => {
    const ticket = ++issued.current
    try {
      const next = await sendReply(reference, replyId, date, thread?.session.turns.at(-1)?.id)
      if (!isThread(next)) throw new Error('MarshBot didn’t get that. Try again.')
      take(next, ticket)
      return next
    } catch (error: unknown) {
      // The conversation moved on (answered in another tab): show it, no error. Any other refusal,
      // such as a 409 for an archived assessment, says why in a toast.
      if (error instanceof GatewayError && error.detail.code === 'reply-not-asked') {
        refresh()
        return null
      }
      toast.error(error instanceof Error ? error.message : 'MarshBot didn’t get that. Try again.')
      return null
    }
  }

  return { thread, failed, retry, reply }
}
