// One dropdown row: kind icon, message, time, and hover actions. Called by NotificationList.
import { useState } from 'react'
import { Icon } from '../../design-system'
import type { Notification } from './api'
import { formatBellWhen } from './formatWhen'
import { KnowledgeRequestDetails } from './KnowledgeRequestDetails'
import { ActionButton } from './components/ActionButton'
import { NotificationIcon } from './components/NotificationIcon'

// Past this many characters the one line under the message is cut off, so Show more earns its place.
const FITS_ONE_LINE = 44

// What the line beside the time says (board 11): the details' first line, or who moved it.
function detailLine(n: Notification) {
  if (n.details) return n.details.split('\n')[0]
  return n.purpose === 'assessment_moved' && n.context?.sender
    ? `${n.context.sender} reassigned it`
    : null
}

export function NotificationRow({
  notification,
  onActivate,
  onMarkRead,
  onDismiss,
}: {
  notification: Notification
  // Navigate to the notification's subject. Called when the row body is
  // clicked; also marks it read.
  onActivate: (notification: Notification) => void
  onMarkRead: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const details = notification.details
  // A knowledge request stored with its parts (CB-07) is laid out with labels; older ones
  // fall back to the plain details text.
  const request =
    notification.purpose === 'knowledge_gap_request' && notification.context?.question
      ? notification.context
      : null
  const line = detailLine(notification)
  // Only when there is more to read than the one line shows.
  const hasMore =
    !!details && (!!request || details.includes('\n') || details.length > FITS_ONE_LINE)

  const activate = () => {
    if (!notification.read) onMarkRead(notification.id)
    onActivate(notification)
  }

  return (
    <li className={`notif-row${notification.read ? '' : ' notif-row-unread'}`}>
      <NotificationIcon notification={notification} />
      <div className="notif-row__body">
        {/* Read state is also spoken, so it is not carried by weight and the accent alone. */}
        {!notification.read && <span className="notif-sr">Unread: </span>}
        <button type="button" onClick={activate} className="notif-row__message">
          <span className={expanded ? undefined : 'notif-clamp'}>{notification.message}</span>
        </button>
        {hasMore && expanded && request && (
          <KnowledgeRequestDetails context={request} onOpen={activate} />
        )}
        {hasMore && expanded && !request && <p className="notif-row__details">{details}</p>}
        <div className="notif-row__meta">
          <span className="notif-row__when">
            <time dateTime={notification.createdAt}>{formatBellWhen(notification.createdAt)}</time>
            {line && !expanded && ` · ${line}`}
          </span>
          {hasMore && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="notif-row__more"
            >
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
      {/* Hidden until hover or focus on a mouse device; always shown on touch (notifications.css). */}
      <div className="notif-row__actions">
        {!notification.read && (
          <ActionButton
            icon="check"
            label="Mark as read"
            placement="bottom"
            onClick={() => onMarkRead(notification.id)}
          />
        )}
        <ActionButton
          icon="x"
          label="Dismiss"
          placement="bottom"
          onClick={() => onDismiss(notification.id)}
        />
      </div>
    </li>
  )
}
