import { useCallback, useRef, useState } from 'react'
import {
  dismissAllNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationPage,
} from './api'

export type NotificationCounts = { total: number; unread: number }

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
export function useNotifications(
  pageSize: number,
  initial: NotificationCounts,
): UseNotifications {
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
    setItems((current) =>
      current.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)),
    )
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
