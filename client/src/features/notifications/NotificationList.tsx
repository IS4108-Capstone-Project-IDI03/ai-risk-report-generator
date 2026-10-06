import { Button, Callout, EmptyState } from '../../design-system'
import { NotificationRow } from './NotificationRow'
import type { UseNotifications } from './useNotifications'
import type { Notification } from './api'

// The dropdown's body: a header with the two bulk actions, the list of rows,
// and a Load more at the foot. Takes the hook's state and the activate handler;
// owns no fetching of its own.
export function NotificationList({
  n,
  onActivate,
}: {
  n: UseNotifications
  onActivate: (notification: Notification) => void
}) {
  const empty = !n.loading && !n.failed && n.items.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <h2 style={{ margin: '0', fontSize: '14px', fontWeight: '600' }}>Notifications</h2>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {n.unread > 0 && (
            <Button variant="ghost" size="sm" onClick={n.markAllRead}>
              Mark all as read
            </Button>
          )}
          {n.items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={n.dismissAll}>
              Dismiss all
            </Button>
          )}
        </div>
      </header>

      <div style={{ overflowY: 'auto' }}>
        {n.failed ? (
          <div style={{ padding: 'var(--space-4)' }}>
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
            description="Updates about ingestion and your work appear here as they happen."
          />
        ) : (
          <ul style={{ margin: '0', padding: '0', listStyle: 'none' }}>
            {n.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onActivate={onActivate}
                onMarkRead={n.markRead}
              />
            ))}
          </ul>
        )}

        {n.loading && n.items.length === 0 && (
          <p
            role="status"
            style={{
              margin: '0',
              padding: 'var(--space-4)',
              fontSize: '13px',
              color: 'var(--text-muted)',
            }}
          >
            Loading notifications…
          </p>
        )}
      </div>

      {n.hasMore && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <Button variant="ghost" size="sm" fullWidth onClick={n.loadMore} disabled={n.loading}>
            {n.loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
