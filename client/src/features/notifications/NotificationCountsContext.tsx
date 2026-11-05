// The one source of the notification counts (F-10): the bell's unread, the Inbox's To do
// count and the sounds that follow their rises. Mounted once above every screen (App.tsx),
// because the bell is mounted again on each screen: counts and the sound baseline kept in
// the bell would restart from the sign-in figures on every screen change and either miss a
// chime or replay one. Read by NotificationBell, AssessmentApp (sidebar) and the Inbox.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getNotificationCount } from './api'
import { chimeFor, chimeOnce, startAudioUnlock, type Counts } from './chime'
import { CountsContext, type NotificationCountsApi } from './useNotificationCounts'

// How often the counts are read. The count route does not extend the session, so polling
// cannot keep an idle tab signed in. Browsers slow a hidden tab's timer to about a minute.
const POLL_MS = 30_000

/** Polls the counts, plays a chime on a rise and shares them with everything below. */
export function NotificationCountsProvider({
  initial,
  children,
}: {
  // The session's figures, so the badge and sidebar are right on first paint.
  initial: Counts
  children: ReactNode
}) {
  const [counts, setCounts] = useState(initial)
  const [outsideChanges, setOutsideChanges] = useState(0)
  const latest = useRef(initial)
  // The last polled counts. Null until the first poll, which only sets it (no sound on load).
  const baseline = useRef<Counts | null>(null)
  // Counted up by every change the person makes. A poll sent before one is dropped when it
  // lands: its old figures would undo the change and then look like a rise.
  const epoch = useRef(0)
  const inFlight = useRef<AbortController | null>(null)

  const change = useCallback<NotificationCountsApi['change']>((update) => {
    epoch.current += 1
    inFlight.current?.abort()
    const next =
      typeof update === 'function' ? update(latest.current) : { ...latest.current, ...update }
    latest.current = next
    if (baseline.current) baseline.current = next
    setCounts(next)
  }, [])

  // One poller for the whole app. It keeps running while the tab is hidden, so a chime can
  // arrive from a background tab (a hidden timer only slows down), and reads at once when
  // the tab is shown again.
  useEffect(() => {
    const stopUnlock = startAudioUnlock()
    const poll = () => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      const sentAt = epoch.current
      getNotificationCount(controller.signal).then(
        (next) => {
          if (controller.signal.aborted || sentAt !== epoch.current) return
          const chime = chimeFor(baseline.current, next)
          const before = latest.current
          baseline.current = next
          latest.current = next
          const moved = next.inboxTodo !== before.inboxTodo
          // Without this check every poll made a new object, and every screen below drew again.
          if (moved || next.total !== before.total || next.unread !== before.unread) setCounts(next)
          if (moved) setOutsideChanges((n) => n + 1)
          if (chime) chimeOnce(chime, next)
        },
        () => {
          // A dropped poll just waits for the next one.
        },
      )
    }
    const timer = setInterval(poll, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      inFlight.current?.abort()
      document.removeEventListener('visibilitychange', onVisible)
      stopUnlock()
    }
  }, [])

  const api = useMemo(() => ({ counts, change, outsideChanges }), [counts, change, outsideChanges])
  return <CountsContext.Provider value={api}>{children}</CountsContext.Provider>
}
