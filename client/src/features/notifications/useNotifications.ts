import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dismissAllNotifications,
  getNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationCounts,
  type NotificationPage,
} from './api'

export type NotificationCounts = { total: number; unread: number }

// How often the badge is refreshed from the gateway while the tab is visible.
// Chosen so a finished job surfaces within a reasonable wait without hammering
// the gateway; the count route does not extend the session, so this does not
// keep an idle tab signed in.
const POLL_MS = 30_000

export type UseNotifications = {
  items: Notification[]
  // Total and unread across the whole visible set, not just what is loaded.
  // Seeded from the session so the badge is right before the list is opened,
  // then replaced by each page the gateway returns.
  total: number
  unread: number
  loading: boolean
  // True once a fetch has failed and nothing is loaded, so the panel can show
  // a retry rather than an empty list.
  failed: boolean
  // Whether more notifications exist beyond what is loaded.
  hasMore: boolean
  // Loads the first page. Safe to call each time the dropdown opens; it
  // refetches so the list reflects anything that arrived since.
  load: () => void
  loadMore: () => void
  markRead: (id: string) => void
  markAllRead: () => void
  dismissAll: () => void
}

// State and gateway calls for the header dropdown. `pageSize` is how many rows
// a page holds (a component concern, so it is passed in). `initial` seeds the
// counts from the session so the bell badge is correct on first paint.
export function useNotifications(pageSize: number, initial: NotificationCounts): UseNotifications {
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(initial.total)
  const [unread, setUnread] = useState(initial.unread)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Abort an in-flight list request if another starts or the panel closes.
  const inFlight = useRef<AbortController | null>(null)

  const apply = useCallback((page: NotificationPage, append: boolean) => {
    setItems((current) => (append ? [...current, ...page.items] : page.items))
    setTotal(page.total)
    setUnread(page.unread)
    setLoaded(true)
    setFailed(false)
  }, [])

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setLoading(true)
      listNotifications(pageSize, offset, controller.signal).then(
        (page) => {
          if (controller.signal.aborted) return
          apply(page, append)
          setLoading(false)
        },
        () => {
          if (controller.signal.aborted) return
          // A failed first load shows the retry; a failed Load more just stops.
          if (!append) setFailed(true)
          setLoading(false)
        },
      )
    },
    [pageSize, apply],
  )

  const load = useCallback(() => fetchPage(0, false), [fetchPage])
  const loadMore = useCallback(() => fetchPage(items.length, true), [fetchPage, items.length])

  // Mark one read: reflect it locally and drop the unread count, then tell the
  // gateway. The list keeps the row (read, not removed).
  const markRead = useCallback((id: string) => {
    setItems((current) => current.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)))
    setUnread((current) => Math.max(0, current - 1))
    markNotificationRead(id).catch(() => {
      // The badge self-corrects on the next open; nothing to undo here.
    })
  }, [])

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((n) => (n.read ? n : { ...n, read: true })))
    setUnread(0)
    markAllNotificationsRead().catch(() => {})
  }, [])

  // Dismiss all: empty the list and zero the counts, then tell the gateway.
  const dismissAll = useCallback(() => {
    setItems([])
    setTotal(0)
    setUnread(0)
    dismissAllNotifications().catch(() => {})
  }, [])

  // Poll the counts on a timer so the badge updates on its own when a job
  // finishes, without the user reloading. Only the counts are refreshed, never
  // the open list (which would fight what the user is reading). Polling pauses
  // while the tab is hidden, and resumes — with an immediate refresh — when it
  // becomes visible again, so a backgrounded tab is quiet. A failed poll is
  // ignored; the next one corrects the badge.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let controller: AbortController | undefined

    const refresh = () => {
      controller?.abort()
      controller = new AbortController()
      getNotificationCount(controller.signal).then(
        (counts) => {
          setTotal(counts.total)
          setUnread(counts.unread)
        },
        () => {
          // Ignore: a dropped poll just means the badge waits for the next one.
        },
      )
    }

    const start = () => {
      if (timer) return
      timer = setInterval(refresh, POLL_MS)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
      controller?.abort()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return {
    items,
    total,
    unread,
    loading,
    failed,
    // Only once a page has loaded can we trust `total`; before that, never
    // offer Load more off the seeded count alone.
    hasMore: loaded && items.length < total,
    load,
    loadMore,
    markRead,
    markAllRead,
    dismissAll,
  }
}
