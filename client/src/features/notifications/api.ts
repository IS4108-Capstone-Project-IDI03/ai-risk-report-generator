// Browser → gateway calls for the header notification dropdown. Reuses the
// shared `request` helper for the list (and its GatewayError + 401 handling)
// so a dropped session ends the same way as everywhere else. The mutations
// return 204 with no body, which `request` (which always parses JSON) cannot
// read, so they go through `send` below — the same transport, without the
// JSON parse.
import { request } from '../accounts/api'
import { GatewayError, reportSessionEnded } from '../assessments/api'

// A gateway call that returns no body (204). Mirrors the error and 401
// handling in accounts/api's `request`, but does not parse a response body.
export async function send(path: string, init: RequestInit): Promise<void> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error: unknown) {
    if (init.signal?.aborted) throw error
    throw new GatewayError(null)
  }
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (response.status === 401) reportSessionEnded()
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { error?: string }
    throw new GatewayError(response.status, problem.error)
  }
}

// Mirrors NOTIFICATION_PURPOSES in server/src/models/notification.model.ts.
export type NotificationPurpose =
  | 'ingestion_status'
  | 'transcription_status'
  | 'drafting_status'
  | 'knowledge_document_status'
  | 'account_status'
  | 'assessment_status'
  | 'knowledge_gap_request'
  | 'site_walk_ready'
  | 'site_walk_failed'
  | 'assessment_assigned'
  | 'assessment_moved'

// One notification as the gateway sends it; matches NotificationDto in
// server/src/services/notification.service.ts. `read` is this user's own state.
export type Notification = {
  id: string
  purpose: NotificationPurpose
  // Where it is shown: the bell, or the Inbox (F-10).
  kind: 'bell' | 'inbox'
  message: string
  details: string | null
  context: Record<string, string> | null
  read: boolean
  // Inbox only: Done for this user, because they opened it or anyone ticked it.
  done: boolean
  // When anyone ticked it; null while it is not ticked. An opened-only item has none.
  doneAt: string | null
  createdAt: string
}

// A page of notifications with the totals the screens need: `total` to decide
// whether to offer Load more, `unread` for the bell badge, `inboxTodo` for the
// sidebar. All cover the whole visible set, not just this page.
export type NotificationPage = {
  items: Notification[]
  total: number
  unread: number
  inboxTodo: number
}

// Just the counts for the header badge, cheap enough to poll on a timer.
// Matches GET /api/notifications/count, which the gateway serves WITHOUT
// refreshing the session, so polling it cannot keep an idle tab signed in.
export function getNotificationCount(signal?: AbortSignal): Promise<NotificationCounts> {
  return request<NotificationCounts>('/api/notifications/count', { signal })
}

// Totals only, as the count route returns them. `total` and `unread` are the bell's.
export type NotificationCounts = { total: number; unread: number; inboxTodo: number }

// One page, newest first. `limit` is clamped server-side; `offset` is how many
// to skip. Matches GET /api/notifications.
export function listNotifications(
  limit: number,
  offset: number,
  signal?: AbortSignal,
  view: { kind: 'bell' | 'inbox'; tab?: 'todo' | 'done' } = { kind: 'bell' },
): Promise<NotificationPage> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    kind: view.kind,
  })
  if (view.tab) query.set('tab', view.tab)
  return request<NotificationPage>(`/api/notifications?${query}`, { signal })
}

// Marks one notification read for the signed-in user. 204, no body.
export function markNotificationRead(id: string): Promise<void> {
  return send(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' })
}

// Marks everything the user can see as read, clearing the badge but keeping the
// list. 204, no body.
export function markAllNotificationsRead(): Promise<void> {
  return send('/api/notifications/read-all', { method: 'POST' })
}

// Clears the user's list (per user; others in the role are unaffected). 204.
export function dismissAllNotifications(): Promise<void> {
  return send('/api/notifications/dismiss-all', { method: 'POST' })
}

// Dismisses one notification for the signed-in user only. 204, no body.
export function dismissNotification(id: string): Promise<void> {
  return send(`/api/notifications/${encodeURIComponent(id)}/dismiss`, { method: 'POST' })
}

// Ticks an Inbox item: Done for this user and, on an admin item, for every admin. 204.
export function markNotificationDone(id: string): Promise<void> {
  return send(`/api/notifications/${encodeURIComponent(id)}/done`, { method: 'POST' })
}

// Unticks an Inbox item: back to To do. 204.
export function unmarkNotificationDone(id: string): Promise<void> {
  return send(`/api/notifications/${encodeURIComponent(id)}/done`, { method: 'DELETE' })
}

// Undoes a bin: the notification returns to this user's lists. 204.
export function restoreNotification(id: string): Promise<void> {
  return send(`/api/notifications/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}
