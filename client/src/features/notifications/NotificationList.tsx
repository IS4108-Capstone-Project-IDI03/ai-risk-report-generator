import { Button, Callout, EmptyState } from '../../design-system'
import { ActionButton } from './components/ActionButton'
import { NotificationRow } from './NotificationRow'
import type { UseNotifications } from './useNotifications'
import type { Notification } from './api'
import './notifications.css'

// The dropdown's body: a header with the two bulk actions, the list of rows,
// and a Load more at the foot. Takes the hook's state and the activate handler;
// owns no fetching of its own.
export function NotificationList({
  n,
  onActivate,
  onClose,
}: {
  n: UseNotifications
  onActivate: (notification: Notification) => void
  onClose?: () => void
}) {
  const empty = !n.loading && !n.failed && n.items.length === 0

  return (
    <div className="notification-list">
      <header className="notification-list__header">
        <div className="notification-list__heading">
          <h2>Notifications</h2>
          <span className="notification-list__count">
            {n.unread > 0 ? `${n.unread} unread` : 'All caught up'}
          </span>
        </div>
        <div className="notification-list__actions">
          {n.unread > 0 && (
            <ActionButton icon="check-check" label="Mark all as read" onClick={n.markAllRead} />
          )}
          {n.items.length > 0 && (
            <ActionButton icon="trash-2" label="Dismiss all" onClick={n.dismissAll} />
          )}
          {onClose && <ActionButton icon="x" label="Close notifications" onClick={onClose} />}
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
              The gateway could not be reached. Check your connection, then try again.
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
