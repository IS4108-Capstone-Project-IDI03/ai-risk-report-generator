// One dropdown row: kind icon, message, time, and hover actions. Called by NotificationList.
import { useState } from 'react'
import { Icon } from '../../design-system'
import type { Notification } from './api'
import { formatWhen } from './formatWhen'
import { KnowledgeRequestDetails } from './KnowledgeRequestDetails'
import { ActionButton } from './components/ActionButton'
import { NotificationIcon } from './components/NotificationIcon'

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
  const hasDetails = Boolean(notification.details)
  // A knowledge request stored with its parts (CB-07) is laid out with labels; older ones
  // fall back to the plain details text.
  const request =
    notification.purpose === 'knowledge_gap_request' && notification.context?.question
      ? notification.context
      : null

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
        {hasDetails && expanded && request && (
          <KnowledgeRequestDetails context={request} onOpen={activate} />
        )}
        {hasDetails && expanded && !request && (
          <p className="notif-row__details">{notification.details}</p>
        )}
        <div className="notif-row__meta">
          <time dateTime={notification.createdAt}>{formatWhen(notification.createdAt)}</time>
          {hasDetails && (
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
