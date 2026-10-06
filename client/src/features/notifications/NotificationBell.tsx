import { useState } from 'react'
import { Icon, Popover } from '../../design-system'
import { useNotifications, type NotificationCounts } from './useNotifications'
import { NotificationList } from './NotificationList'
import type { Notification } from './api'

export type NotificationBellProps = {
  // Counts from the session, so the badge is right before the dropdown opens.
  counts: NotificationCounts
  // How many rows a page holds. A component concern, not a constant.
  pageSize?: number
  // Navigate to a notification's subject. Given the notification so the caller
  // can route by purpose/context; the row has already marked it read.
  onActivate?: (notification: Notification) => void
  // On a dark bar (mobile) the bell is white; in the light page header it uses
  // the normal control colour.
  tone?: 'light' | 'dark'
}

// The header entry point: a bell with an unread count that opens the dropdown.
// Owns the open state and the data hook; the Popover owns dismissal.
export function NotificationBell({
  counts,
  pageSize = 5,
  onActivate,
  tone = 'light',
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const n = useNotifications(pageSize, counts)

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Fetch on open so the list reflects anything that arrived since sign-in.
    if (next) n.load()
  }

  const label = n.unread > 0 ? `Notifications, ${n.unread} unread` : 'Notifications'
  const color = tone === 'dark' ? '#fff' : 'var(--text-secondary)'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Notifications"
      align="right"
      trigger={
        <button
          type="button"
          aria-label={label}
          onClick={toggle}
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '99px',
            background: 'transparent',
            color,
            cursor: 'pointer',
            transition: 'var(--transition-control)',
          }}
          data-hoverable="true"
        >
          <Icon name="bell" size={18} />
          {n.unread > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                minWidth: '16px',
                height: '16px',
                padding: '0 4px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '99px',
                background: 'var(--ink-600)',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                lineHeight: '1',
                fontWeight: '600',
              }}
            >
              {n.unread > 99 ? '99+' : n.unread}
            </span>
          )}
        </button>
      }
    >
      <NotificationList n={n} onActivate={onActivate ?? (() => setOpen(false))} />
    </Popover>
  )
}
