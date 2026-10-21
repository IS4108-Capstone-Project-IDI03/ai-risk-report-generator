import { useEffect, useRef, useState } from 'react'
import { IconButton, Popover } from '../../design-system'
import { useNotifications, type NotificationCounts } from './useNotifications'
import './notifications.css'
import { NotificationList } from './NotificationList'
import type { Notification } from './api'
import { KNOWLEDGE_REVIEW_PATH, SCREEN_PATHS } from '../auth/access'
import { openKnowledgeTab } from '../knowledge-base/openTab'

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

  // Plays the pulse and tilt once each time the count rises while the page is
  // open. The first value is skipped, so loading the page with unread items is
  // calm. Bumping `pulse` changes the badge's key, which restarts its animation.
  const previous = useRef(n.unread)
  const [pulse, setPulse] = useState(0)
  const [ringing, setRinging] = useState(false)
  useEffect(() => {
    if (n.unread > previous.current) {
      setPulse((p) => p + 1)
      setRinging(true)
    }
    previous.current = n.unread
  }, [n.unread])

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Fetch on open so the list reflects anything that arrived since sign-in.
    if (next) n.load()
  }

  const label = n.unread > 0 ? `Notifications, ${n.unread} unread` : 'Notifications'
  const color = tone === 'dark' ? '#fff' : 'var(--text-primary)'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Notifications"
      align="right"
      surfaceClassName="notification-popover-surface"
      trigger={
        <IconButton
          icon="bell"
          label={label}
          // Large, so the bell is noticed on every page (UI polish, 21 Oct).
          size="lg"
          selected={open}
          className={`notif-bell notif-bell--${tone}${ringing ? ' notif-bell--ring' : ''}`}
          onAnimationEnd={(e) => e.target === e.currentTarget && setRinging(false)}
          onClick={toggle}
          style={{
            position: 'relative',
            color,
            ['--surface-hover' as string]:
              tone === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'var(--surface-hover)',
            ['--surface-selected' as string]:
              tone === 'dark' ? 'rgba(255, 255, 255, 0.16)' : 'var(--surface-selected)',
          }}
        >
          {n.unread > 0 && (
            <span key={pulse} aria-hidden="true" className="notif-badge">
              {n.unread > 99 ? '99+' : n.unread}
            </span>
          )}
        </IconButton>
      }
    >
      <NotificationList
        n={n}
        onActivate={
          onActivate ??
          ((notification) => {
            setOpen(false)
            openSubject(notification)
          })
        }
        onClose={() => setOpen(false)}
      />
    </Popover>
  )
}

// Opens what a notification is about, where it has a page. A document that
// needs review (IN-07) opens its Review page: the URL changes and popstate
// tells the app and the knowledge base to follow it, as the browser's Back does.
function openSubject(notification: Notification) {
  if (notification.purpose === 'knowledge_gap_request') return openKnowledgeRequest(notification)
  const { documentId, status } = notification.context ?? {}
  if (status !== 'needs_review' || !documentId) return
  const path = KNOWLEDGE_REVIEW_PATH + encodeURIComponent(documentId)
  // Already there: a second entry would make Back land on the same page.
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// A knowledge request (CB-07). The admin's "New knowledge request" has no status in its context,
// so it opens Requests; the engineer's outcome (filled or dismissed) carries one and opens the chat.
function openKnowledgeRequest(notification: Notification) {
  if (!notification.context?.status)
    return openKnowledgeTab('requests', notification.context?.requestId)
  if (window.location.pathname === SCREEN_PATHS.chat) return
  window.history.pushState(null, '', SCREEN_PATHS.chat)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
