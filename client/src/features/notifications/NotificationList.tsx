import { Button, Callout, EmptyState, IconAction } from '../../design-system'
import { NotificationRow } from './NotificationRow'
import type { UseNotifications } from './useNotifications'
import type { Notification } from './api'
import './notifications.css'

// The thin header's buttons are 28 px (v2 "Thin popover header"); 44 px on touch (notifications.css).
const HEADER_BUTTON = { width: 28, height: 28 }

// The dropdown's body: a thin header with the two bulk actions, the list of rows,
// and a Load more at the foot. Takes the hook's state and the activate handler;
// owns no fetching of its own. Esc, a press outside, or the phone sheet closes it.
export function NotificationList({
  n,
  onActivate,
}: {
  n: UseNotifications
  onActivate: (notification: Notification) => void
}) {
  const empty = !n.loading && !n.failed && n.items.length === 0

  return (
    <div className="notification-list">
      <header className="notification-list__header">
        <h2>Notifications</h2>
        <div className="notification-list__actions">
          {n.unread > 0 && (
            <IconAction
              icon="check-check"
              label="Mark all as read"
              placement="bottom"
              className="notif-action"
              style={HEADER_BUTTON}
              onClick={n.markAllRead}
            />
          )}
          {n.items.length > 0 && (
            <IconAction
              icon="trash-2"
              label="Dismiss all"
              placement="bottom"
              className="notif-action"
              style={HEADER_BUTTON}
              onClick={n.dismissAll}
            />
          )}
        </div>
      </header>

      <div className="notification-list__body">
        {n.failed ? (
          <div className="notification-list__message">
            <Callout
              tone="danger"
              title="Notifications not loaded"
              actions={
                <Button variant="secondary" size="sm" onClick={n.load}>
                  Try again
                </Button>
              }
            >
              Can't reach the server. Check your connection, then try again.
            </Callout>
          </div>
        ) : empty ? (
          <EmptyState
            icon="bell"
            title="No notifications"
            description="New activity will appear here as it happens."
          />
        ) : (
          <ul>
            {n.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onActivate={onActivate}
                onMarkRead={n.markRead}
                onDismiss={n.dismiss}
              />
            ))}
          </ul>
        )}

        {n.loading && n.items.length === 0 && (
          <p role="status" className="notification-list__loading">
            Loading notifications…
          </p>
        )}
      </div>

      {n.hasMore && (
        <div className="notification-list__footer">
          <Button variant="ghost" size="sm" fullWidth onClick={n.loadMore} disabled={n.loading}>
            {n.loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
