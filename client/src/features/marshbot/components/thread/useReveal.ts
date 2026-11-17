// The one-message-at-a-time queue (AS-06 round 9): a bot turn pushed in while the screen is open
// shows one message (a speech bubble or a card) at a time, not all at once. The first comes 700 ms
// after the typing dots, each next one 1.5 s after the one before, and the choices are a beat of
// their own after the last message. Turns there when the screen opened, and everything under
// reduced motion or in a hidden tab, show at once.
// Called by screens/MarshBotOverview.tsx, which hands it to Thread.tsx and uses it to hold the
// status pill. Read by Flow.tsx through context.ts's RevealContext.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ACTIONS_MS, FIRST_MESSAGE_MS, MESSAGE_GAP_MS } from '../../settings'
import type { AssistantThread } from '../../types'

export type Reveal = {
  // The pushed bot turns, oldest first.
  fresh: Set<string>
  // True when everything shows at once (reduced motion, or a hidden tab): no queue, no hold.
  instant: boolean
  // True while messages wait to be shown: the typing dots stay.
  pending: boolean
  // True until the choices' own beat after the last message: they are held back.
  held: boolean
  // Whether message `index` of turn `id` is on screen.
  shows: (id: string, index: number) => boolean
  // Whether none of turn `id`'s messages is on screen yet (so its face and name wait too).
  hidden: (id: string) => boolean
  // A turn tells how many messages it has; the returned function takes that back.
  register: (id: string, count: number) => () => void
}

// Reduced motion, or no matchMedia (jsdom tests that don't opt in): no queue.
const calm = () =>
  typeof window.matchMedia !== 'function' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A turn that never tells its count (it should always) is treated as empty after this long;
// without it, the choices would never come back.
const REGISTER_GRACE_MS = 1000

// The choices' beat is keyed to the newest pushed turn, so a later turn holds them back again.
const SLOT = 'slot:'

/** Returns the reveal queue for `thread`; `replying` is true while the engineer's reply is sent. */
export function useReveal(thread: AssistantThread, replying: boolean): Reveal {
  const botIds = thread.session.turns.filter((t) => t.who === 'bot').map((t) => t.id)
  // The bot turns already there when the screen opened draw at once.
  const [known] = useState(() => new Set(botIds))
  const fresh = botIds.filter((id) => !known.has(id))
  const [counts, setCounts] = useState<Record<string, number>>({})
  // What has been shown, as "turnId:index" (and the choices' key). Something shown is never
  // hidden again: without this, a turn landing before one already shown would shift a shared
  // running count and blank that message for a gap.
  const [shown, setShown] = useState<Set<string>>(() => new Set())
  // A hidden tab throttles timers, so the engineer would come back to a thread still dripping old
  // messages: while it is hidden, everything shows at once.
  const [away, setAway] = useState(() => document.hidden)
  useEffect(() => {
    const change = () => setAway(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  const instant = calm() || away

  // Every beat in order: each pushed turn's messages, then the choices under the newest turn.
  const beats: string[] = []
  let allKnown = true
  for (const id of fresh) {
    if (counts[id] === undefined) allKnown = false
    for (let i = 0; i < (counts[id] ?? 0); i += 1) beats.push(`${id}:${i}`)
  }
  const lastFresh = fresh.at(-1)
  if (lastFresh) beats.push(SLOT + lastFresh)
  const next = allKnown ? beats.find((b) => !shown.has(b)) : undefined
  const pending = !instant && (!allKnown || (next !== undefined && !next.startsWith(SLOT)))
  const held = !instant && lastFresh !== undefined && !shown.has(SLOT + lastFresh)
  const waiting = thread.thinking || replying || pending

  // While the tab is hidden every beat counts as shown, so none is hidden again (and replayed)
  // when the tab comes back. Set while rendering (React's own pattern for state that follows
  // other state): an effect would draw one frame with the messages still hidden.
  if (away && beats.some((beat) => !shown.has(beat))) setShown(new Set([...shown, ...beats]))

  const shows = (id: string, index: number) =>
    instant || !fresh.includes(id) || shown.has(`${id}:${index}`)
  const hidden = (id: string) => !instant && fresh.includes(id) && !shows(id, 0)
  const register = useCallback((id: string, count: number) => {
    setCounts((c) => (c[id] === count ? c : { ...c, [id]: count }))
    return () => setCounts((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== id)))
  }, [])

  // When the dots (or the wait for the choices) began, and when the last beat was shown.
  const since = useRef<number | null>(null)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (instant) return
    if (!waiting && !held) {
      since.current = null
      return
    }
    since.current ??= Date.now()
    if (!next) return
    // A message never comes before the first message's beat, nor sooner than the gap after the
    // last one; the choices come their own beat after the last message. One that arrives late is
    // due already, so it shows at once.
    const isSlot = next.startsWith(SLOT)
    const due = isSlot
      ? (last.current ?? since.current) + ACTIONS_MS
      : Math.max(since.current + FIRST_MESSAGE_MS, (last.current ?? -Infinity) + MESSAGE_GAP_MS)
    const timer = setTimeout(
      () => {
        last.current = Date.now()
        setShown((s) => new Set(s).add(next))
      },
      Math.max(0, due - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [instant, waiting, held, next])

  // The grace for a turn that never told its count.
  const unknown = fresh.filter((id) => counts[id] === undefined).join()
  useEffect(() => {
    if (!unknown) return
    const timer = setTimeout(
      () =>
        setCounts((c) => ({
          ...Object.fromEntries(unknown.split(',').map((id) => [id, 0])),
          ...c,
        })),
      REGISTER_GRACE_MS,
    )
    return () => clearTimeout(timer)
  }, [unknown])

  return { fresh: new Set(fresh), instant, pending, held, shows, hidden, register }
}
