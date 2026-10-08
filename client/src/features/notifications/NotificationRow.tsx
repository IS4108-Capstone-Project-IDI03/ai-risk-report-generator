import { useState } from 'react'
import { Icon, IconButton } from '../../design-system'
import type { Notification } from './api'

// A literal, mono timestamp like "11 Apr 09:22" (docs/design-system.md: dates
// are literal and in mono, never relative). Falls back to the raw value if the
// date cannot be parsed, rather than showing "Invalid Date".
function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

export function NotificationRow({
  notification,
  onActivate,
  onMarkRead,
}: {
  notification: Notification
  // Navigate to the notification's subject. Called when the row body is
  // clicked; also marks it read.
  onActivate: (notification: Notification) => void
  onMarkRead: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Boolean(notification.details)

  const activate = () => {
    if (!notification.read) onMarkRead(notification.id)
    onActivate(notification)
  }

  return (
    <li
      className={`notif-row${notification.read ? '' : ' notif-row-unread'}`}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-subtle)',
        background: notification.read ? 'transparent' : 'var(--surface-hover)',
      }}
    >
      {/* Unread marker, also announced to assistive tech so read state is not
          carried by colour alone. */}
      <span
        aria-hidden={notification.read}
        aria-label={notification.read ? undefined : 'Unread'}
        style={{
          flex: '0 0 auto',
          width: '8px',
          height: '8px',
          marginTop: '7px',
          borderRadius: '99px',
          background: notification.read ? 'transparent' : 'var(--ink-600)',
        }}
      />
      <div style={{ flex: '1', minWidth: '0' }}>
        <button
          type="button"
          onClick={activate}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            border: 'none',
            background: 'transparent',
            padding: '0',
            cursor: 'pointer',
            font: 'inherit',
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontSize: '14px', lineHeight: '20px' }}>{notification.message}</span>
        </button>
        {hasDetails && expanded && (
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              fontSize: '13px',
              lineHeight: '19px',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {notification.details}
          </p>
        )}
        <div
          style={{
            marginTop: 'var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <time
            dateTime={notification.createdAt}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-muted)',
            }}
          >
            {formatWhen(notification.createdAt)}
          </time>
          {hasDetails && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                border: 'none',
                background: 'transparent',
                padding: '0',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
      {!notification.read && (
        <IconButton
          icon="check"
          label="Mark as read"
          size="sm"
          onClick={() => onMarkRead(notification.id)}
        />
      )}
    </li>
  )
}
