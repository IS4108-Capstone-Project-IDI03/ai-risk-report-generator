import { useCallback, useRef, useState } from 'react'
import {
  dismissAllNotifications,
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationPage,
} from './api'
import { useNotificationCounts } from './useNotificationCounts'

export type UseNotifications = {
  items: Notification[]
  // The bell's total and unread across the whole visible set, not just what is
  // loaded. They live in NotificationCountsContext (one poller for the app); each
  // page the gateway returns corrects them.
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
  dismiss: (id: string) => void
  dismissAll: () => void
}

// State and gateway calls for the header dropdown. `pageSize` is how many rows
// a page holds (a component concern, so it is passed in).
export function useNotifications(pageSize: number): UseNotifications {
  const [items, setItems] = useState<Notification[]>([])
  const {
    counts: { total, unread },
    change,
  } = useNotificationCounts()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Abort an in-flight list request if another starts or the panel closes.
  const inFlight = useRef<AbortController | null>(null)

  const apply = useCallback(
    (page: NotificationPage, append: boolean) => {
      // Skips rows already shown: a Load more sent before a dismiss reached the
      // server would otherwise repeat the last row.
      setItems((current) =>
        append
          ? [...current, ...page.items.filter((n) => !current.some((c) => c.id === n.id))]
          : page.items,
      )
      change({ total: page.total, unread: page.unread, inboxTodo: page.inboxTodo })
      setLoaded(true)
      setFailed(false)
    },
    [change],
  )

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setLoading(true)
      listNotifications(pageSize, offset, controller.signal, { kind: 'bell' }).then(
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
  const markRead = useCallback(
    (id: string) => {
      setItems((current) => current.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)))
      change((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }))
      // Failed: the count goes back, or the next poll would read as a rise and chime on your
      // own action. The row corrects itself on the next open.
      markNotificationRead(id).catch(() => change((c) => ({ ...c, unread: c.unread + 1 })))
    },
    [change],
  )

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((n) => (n.read ? n : { ...n, read: true })))
    change({ unread: 0 })
    markAllNotificationsRead().catch(() => change((c) => ({ ...c, unread: c.unread + unread })))
  }, [change, unread])

  // Dismiss one: drop the row now and adjust the counts, then tell the gateway.
  // A failed call puts the counts back (no false chime); the next open puts the row back.
  const dismiss = useCallback(
    (id: string) => {
      const row = items.find((n) => n.id === id)
      if (!row) return
      setItems((current) => current.filter((n) => n.id !== id))
      change((c) => ({
        ...c,
        total: Math.max(0, c.total - 1),
        unread: row.read ? c.unread : Math.max(0, c.unread - 1),
      }))
      dismissNotification(id).catch(() =>
        change((c) => ({
          ...c,
          total: c.total + 1,
          unread: row.read ? c.unread : c.unread + 1,
        })),
      )
    },
    [items, change],
  )

  // Dismiss all: empty the list and zero the counts, then tell the gateway.
  const dismissAll = useCallback(() => {
    setItems([])
    change({ total: 0, unread: 0 })
    dismissAllNotifications().catch(() =>
      change((c) => ({ ...c, total: c.total + total, unread: c.unread + unread })),
    )
  }, [change, total, unread])

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
    dismiss,
    dismissAll,
  }
}
