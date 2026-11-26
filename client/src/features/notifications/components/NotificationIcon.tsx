// The 32px tinted tile (the shared IconTile) that shows what a notification is about. CB-07 UI polish.
// Used by NotificationRow. The glyph comes from the purpose, the colour from context.status,
// so a failed upload and a failed transcription share a colour but not a shape.
import { IconTile } from '../../../design-system'
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
  knowledge_gap_request: 'book-open',
  site_walk_ready: 'sparkles',
  site_walk_failed: 'mic',
  assessment_assigned: 'clipboard-list',
  assessment_moved: 'arrow-left-right',
}

export function NotificationIcon({ notification }: { notification: Notification }) {
  // A move is a plain update, so its tile is grey, not the navy of "no status".
  const drafting = notification.purpose === 'drafting_status'
  // Drafting (GN-13): the AI's blue sparkles when ready, a red alert when a part failed (board 17).
  const status =
    notification.purpose === 'assessment_moved'
      ? 'dismissed'
      : drafting && notification.context?.status === 'ready'
        ? undefined
        : notification.context?.status
  const tone = toneFor(status)
  const icon =
    drafting && notification.context?.status === 'failed'
      ? 'circle-alert'
      : (ICON_FOR_PURPOSE[notification.purpose] ?? 'bell')
  return <IconTile icon={icon} tone={tone} className="notif-icon" data-icon={icon} />
}
