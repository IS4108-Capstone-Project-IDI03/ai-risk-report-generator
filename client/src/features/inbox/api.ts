// Browser to gateway calls for the Inbox (F-10). The Inbox lists the same notifications as
// the bell, asked for as kind "inbox"; opening and binning reuse the bell's calls. Called by
// useInbox.ts. The transport (errors, the 401 handling) is notifications/api.ts's.
import {
  dismissNotification,
  listNotifications,
  markNotificationDone,
  markNotificationRead,
  restoreNotification,
  unmarkNotificationDone,
  type NotificationPage,
} from '../notifications/api'

export type InboxTab = 'todo' | 'done'

// How many rows a page holds. The gateway caps a page at 50; Done can hold more than that
// over its 90 days, so the list offers Load more.
export const PAGE_SIZE = 20

/** Returns one page of the Inbox's To do or Done list, newest first. */
export function listInbox(
  tab: InboxTab,
  offset: number,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return listNotifications(PAGE_SIZE, offset, signal, { kind: 'inbox', tab })
}

// Each is one gateway call that answers 204. The names say what a person did to a row.
export const openItem = markNotificationRead
export const tickItem = markNotificationDone
export const untickItem = unmarkNotificationDone
export const binItem = dismissNotification
export const unbinItem = restoreNotification
