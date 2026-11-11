// The open Overview's brief (AS-06): read once, read again on every push, and changed by a
// quick reply or a dismissal. Called by screens/MarshBotOverview.tsx. Calls api.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../design-system'
import { dismissItem, getBrief, sendReply, useBriefStream } from './api'
import type { AssistantBrief, BriefItem, QuickReply } from './types'

export type BriefState = {
  brief: AssistantBrief | null
  failed: boolean
  // Reads the brief again after a failed first read.
  retry: () => void
  // Items a push just resolved, kept a moment so their rows can tick off (board 12).
  ticked: Map<string, BriefItem>
  // The viewer's last open before this one, from the first read only: later reads are pushes.
  firstLastOpened: string | null
  reply: (reply: QuickReply, date?: string) => Promise<boolean>
  dismiss: (itemId: string) => Promise<boolean>
}

// A gateway without MarshBot answers something else: treat it as a failed read, not a crash.
const isBrief = (b: AssistantBrief | null | undefined): b is AssistantBrief =>
  Array.isArray(b?.messages)

/** Returns the brief, what a push just resolved, and the reply and dismiss actions. */
export function useBrief(reference: string): BriefState {
  const [brief, setBrief] = useState<AssistantBrief | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [ticked, setTicked] = useState<Map<string, BriefItem>>(new Map())
  const [firstLastOpened, setFirstLastOpened] = useState<string | null>(null)
  const current = useRef<AssistantBrief | null>(null)
  // One read at a time: 'again' asks for one more read once the running one ends.
  const reading = useRef<'idle' | 'busy' | 'again'>('idle')

  // A new brief replaces the old; any item the old one had open that the new one no longer
  // does (gone, or resolved) ticks off. An older brief is ignored: without this, a slow read
  // answering after a newer one (or after a reply) would put stale messages back.
  const take = useCallback((next: AssistantBrief) => {
    const before = current.current
    if (before && next.updatedAt < before.updatedAt) return
    current.current = next
    setBrief(next)
    if (!before) return
    const open = new Set(next.items.filter((i) => !i.resolvedAt).map((i) => i.id))
    const done = before.items.filter((i) => !i.resolvedAt && !open.has(i.id))
    if (done.length) setTicked((t) => new Map([...t, ...done.map((i) => [i.id, i] as const)]))
  }, [])

  // Reads the brief again; a call while a read runs asks for one more read after it, so a
  // burst of pushes costs two reads, not one each.
  const refresh = useCallback(
    function read() {
      if (reading.current !== 'idle') {
        reading.current = 'again'
        return
      }
      reading.current = 'busy'
      // A failed read keeps what is on screen.
      getBrief(reference)
        .then((b) => isBrief(b) && take(b))
        .catch(() => undefined)
        .finally(() => {
          const again = reading.current === 'again'
          reading.current = 'idle'
          if (again) read()
        })
    },
    [reference, take],
  )

  // a. The first read: it also tells whether anything changed since the last open.
  useEffect(() => {
    const abort = new AbortController()
    current.current = null
    reading.current = 'busy'
    getBrief(reference, abort.signal)
      .then((b) => {
        if (!isBrief(b)) throw new Error('Not a brief')
        setFirstLastOpened(b.lastOpenedAt)
        take(b)
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true)
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
  }, [reference, take, refresh, attempt])

  // b. Every push, and every (re)connect of the stream, reads it again.
  useBriefStream(reference, refresh)

  const retry = () => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  const reply = async (r: QuickReply, date?: string) => {
    try {
      take(await sendReply(reference, r.id, date))
      return true
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'MarshBot didn’t get that. Try again.')
      return false
    }
  }

  // The row folds away at once (ActionRow); the next push leaves the item out.
  const dismiss = async (itemId: string) => {
    try {
      await dismissItem(reference, itemId)
      return true
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t dismiss that. Try again.')
      return false
    }
  }

  return { brief, failed, retry, ticked, firstLastOpened, reply, dismiss }
}
