// The Inbox's list state (F-10): which tab, the rows loaded, each row's animation phase, and
// how a refetch keeps rows that are mid-animation from jumping. Called by screens/Inbox.tsx.
// Calls api.ts; useInboxActions.ts changes the list through the setters returned here.
import { useEffect, useRef, useState } from 'react'
import type { Notification } from '../notifications/api'
import { useNotificationCounts } from '../notifications/useNotificationCounts'
import { listInbox, type InboxTab } from './api'
import { forgetOpened, returnedByBack } from './inboxReturn'

// 'ticked' is a row shown already ticked when you come back by Back; 'ticking' and 'unticking'
// are the circle's own animation before the row leaves; 'leaving' is a row closing up.
export type Phase = 'ticked' | 'ticking' | 'unticking' | 'leaving'

// Times from the spec's motion table: the circle fills in 120 ms and the tick draws in 260,
// a 240 ms pause, then the row leaves in 180. Must match inbox.css.
export const EXIT_AFTER_MS = 620
export const LEAVE_MS = 180
const BACK_PAUSE_MS = 240
// How long a new row holds its blue tint (1 s plus its 260 ms fade, inbox.css).
const FRESH_MS = 1300

export type UseInbox = ReturnType<typeof useInbox>

/** Returns the Inbox list and everything that changes it. */
export function useInbox() {
  const { change, outsideChanges } = useNotificationCounts()
  const [tab, setTab] = useState<InboxTab>('todo')
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  // Which tab `items` belong to, so a tab switch never shows the old tab's rows under the new.
  const [loadedTab, setLoadedTab] = useState<InboxTab | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [phases, setPhases] = useState<Record<string, Phase>>({})
  // Rows that arrived while the screen was open: they fade in and hold a blue tint.
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  // True once a row left because of something the person did here, so "All done" draws in.
  const [cleared, setCleared] = useState(false)

  const timers = useRef(new Map<string, number[]>())
  // Rows that have left. A refetch sent before one left could still list it.
  const gone = useRef(new Set<string>())
  const inFlight = useRef<AbortController | null>(null)
  // Counted up by every fresh read of a tab, so an older Load more's reply is dropped.
  const generation = useRef(0)
  // The latest list, phases and loader, for the timers and replies that outlive a render.
  const itemsRef = useRef(items)
  const phasesRef = useRef(phases)
  const loadedRef = useRef(loadedTab)
  const tabRef = useRef(tab)
  const loadRef = useRef<(forTab: InboxTab) => void>(() => {})
  // Rows opened here, shown leaving again if this arrival is the browser's Back.
  const [returned] = useState(() => returnedByBack())
  const showReturned = useRef(returned.length > 0)

  const setPhase = (id: string, phase: Phase | null) =>
    setPhases((current) => {
      const next = { ...current }
      if (phase) next[id] = phase
      else delete next[id]
      return next
    })

  const later = (id: string, ms: number, run: () => void) => {
    const list = timers.current.get(id) ?? []
    list.push(window.setTimeout(run, ms))
    timers.current.set(id, list)
  }

  /** Stops a row's pending animation and brings it back to rest (an Undo, or a failed call). */
  const cancel = (id: string) => {
    timers.current.get(id)?.forEach(clearTimeout)
    timers.current.delete(id)
    gone.current.delete(id)
    setPhase(id, null)
  }

  const remove = (id: string) => {
    gone.current.add(id)
    timers.current.delete(id)
    setItems((current) => current.filter((n) => n.id !== id))
    setTotal((current) => Math.max(0, current - 1))
    setPhase(id, null)
    setCleared(true)
  }

  /** Plays a row's exit: the circle's animation first for a tick or untick, then it closes up. */
  const leave = (id: string, phase: 'ticking' | 'unticking' | 'leaving') => {
    setPhase(id, phase)
    later(id, (phase === 'leaving' ? 0 : EXIT_AFTER_MS) + LEAVE_MS, () => remove(id))
  }

  // A page replaces the list, but a row that is still leaving stays where it was until it is
  // gone, and a row that has already left is not brought back by an older reply.
  const apply = (page: Notification[], forTab: InboxTab) => {
    // A different tab's rows are not "before": nothing there to keep, nothing new to tint.
    const sameTab = loadedRef.current === forTab
    const before = sameTab ? itemsRef.current : []
    const stay = before.filter((n) => phasesRef.current[n.id] && !page.some((p) => p.id === n.id))
    const next = page.filter((n) => !gone.current.has(n.id))
    for (const row of stay) next.splice(Math.min(before.indexOf(row), next.length), 0, row)
    // Back: the rows just opened show once more, ticked, and leave after a short pause. Used
    // up by the first To do page that lands (React's dev double-run aborts the first request).
    if (showReturned.current && forTab === 'todo') {
      showReturned.current = false
      for (const row of returned) {
        if (next.some((n) => n.id === row.id)) continue
        const at = next.findIndex((n) => n.createdAt < row.createdAt)
        next.splice(at < 0 ? next.length : at, 0, row)
        setPhase(row.id, 'ticked')
        later(row.id, BACK_PAUSE_MS, () => leave(row.id, 'leaving'))
      }
    }
    // After the first load, anything new fades in with the tint.
    const arrived = !sameTab ? [] : next.filter((n) => !before.some((b) => b.id === n.id))
    if (arrived.length) {
      setFresh(new Set(arrived.map((n) => n.id)))
      window.setTimeout(() => setFresh(new Set()), FRESH_MS)
    }
    setItems(next)
  }

  /** Fetches the first page of a tab; a reload keeps rows that are mid-animation. */
  const load = (forTab: InboxTab) => {
    generation.current += 1
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    listInbox(forTab, 0, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        apply(page.items, forTab)
        // The page carries the bell's and the Inbox's counts: the sidebar follows the list.
        change({ unread: page.unread, inboxTodo: page.inboxTodo })
        setTotal(page.total)
        setLoadedTab(forTab)
        setFailed(false)
      },
      () => {
        if (!controller.signal.aborted) setFailed(true)
      },
    )
  }
  useEffect(() => {
    itemsRef.current = items
    phasesRef.current = phases
    loadedRef.current = loadedTab
    tabRef.current = tab
    loadRef.current = load
  })

  const loadMore = () => {
    setLoadingMore(true)
    const sentFor = generation.current
    // Rows mid-exit have left the server's list, so counting them would skip a row.
    const offset = items.filter((n) => !phases[n.id]).length
    listInbox(tab, offset).then(
      (page) => {
        setLoadingMore(false)
        // Without this a late To do page would land in Done, or over a fresher list.
        if (generation.current !== sentFor) return
        const shown = new Set(items.map((n) => n.id))
        setItems((current) => [
          ...current,
          ...page.items.filter((n) => !shown.has(n.id) && !gone.current.has(n.id)),
        ])
        setTotal(page.total)
      },
      () => setLoadingMore(false),
    )
  }

  // A tab switch starts from a clean list; the first load of the screen may add Back's rows.
  // Without clearing the timers, a row ticked just before the switch would show fading in Done,
  // then vanish until a reload and lower the total.
  useEffect(() => {
    gone.current.clear()
    timers.current.forEach((list) => list.forEach(clearTimeout))
    timers.current.clear()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets with the tab it follows
    setPhases({})
    loadRef.current(tab)
    forgetOpened()
    const request = inFlight
    return () => request.current?.abort()
  }, [tab])

  // Someone else moved the To do count while the Inbox is open (new work, or an admin ticking a
  // shared item): read the tab showing again, so rows arrive and leave. A row mid-exit stays.
  // shortcut: a change that leaves the count equal (one ticked, one new) waits for the next
  // change or tab switch; a list version from the gateway would catch it.
  const seenChanges = useRef(outsideChanges)
  const missed = useRef(false)
  useEffect(() => {
    if (outsideChanges === seenChanges.current) return
    seenChanges.current = outsideChanges
    // The list route refreshes the session cookie: reading it while hidden would let arrivals keep
    // an idle tab signed in.
    if (document.visibilityState === 'visible') loadRef.current(tabRef.current)
    else missed.current = true
  }, [outsideChanges])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !missed.current) return
      missed.current = false
      loadRef.current(tabRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Leaving the screen stops every pending animation timer.
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((list) => list.forEach(clearTimeout))
  }, [])

  return {
    tab,
    setTab,
    items: loadedTab === tab ? items : [],
    loaded: loadedTab === tab,
    total,
    hasMore: loadedTab === tab && items.length < total,
    loadingMore,
    failed,
    phases,
    fresh,
    cleared,
    // Reads the tab now showing, not the one when an Undo's toast was made.
    reload: () => loadRef.current(tabRef.current),
    loadMore,
    leave,
    cancel,
  }
}
