// The 32px tinted circle that shows what a notification is about. CB-07 UI polish.
// Used by NotificationRow. The glyph comes from the purpose, the colour from context.status,
// so a failed upload and a failed transcription share a colour but not a shape.
import { Icon } from '../../../design-system'
import type { Notification } from '../api'
import { toneFor } from './notificationTone'

// One glyph per purpose (NOTIFICATION_PURPOSES in server/src/models/notification.model.ts).
const ICON_FOR_PURPOSE: Record<Notification['purpose'], string> = {
  ingestion_status: 'file-up',
  transcription_status: 'mic',
  drafting_status: 'sparkles',
  knowledge_document_status: 'book-open',
  account_status: 'user',
  assessment_status: 'clipboard-list',
  knowledge_gap_request: 'inbox',
}

export function NotificationIcon({ notification }: { notification: Notification }) {
  const { fg, bg } = toneFor(notification.context?.status)
  const icon = ICON_FOR_PURPOSE[notification.purpose] ?? 'bell'
  return (
    <span className="notif-icon" data-icon={icon} style={{ color: fg, background: bg }}>
      <Icon name={icon} size={16} />
    </span>
  )
}
