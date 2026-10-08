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
async function send(path: string, init: RequestInit): Promise<void> {
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

// One notification as the gateway sends it; matches NotificationDto in
// server/src/services/notification.service.ts. `read` is this user's own state.
export type Notification = {
  id: string
  purpose: NotificationPurpose
  message: string
  details: string | null
  context: Record<string, string> | null
  read: boolean
  createdAt: string
}

// A page of notifications with the totals the dropdown needs: `total` to decide
// whether to offer Load more, `unread` for the bell badge. Both cover the whole
// visible set, not just this page.
export type NotificationPage = {
  items: Notification[]
  total: number
  unread: number
}

// Just the counts for the header badge, cheap enough to poll on a timer.
// Matches GET /api/notifications/count, which the gateway serves WITHOUT
// refreshing the session, so polling it cannot keep an idle tab signed in.
export function getNotificationCount(signal?: AbortSignal): Promise<NotificationCounts> {
  return request<NotificationCounts>('/api/notifications/count', { signal })
}

// Totals only, as the count route returns them.
export type NotificationCounts = { total: number; unread: number }

// One page, newest first. `limit` is clamped server-side; `offset` is how many
// to skip. Matches GET /api/notifications.
export function listNotifications(
  limit: number,
  offset: number,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
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
