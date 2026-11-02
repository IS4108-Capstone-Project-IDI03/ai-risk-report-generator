import { Badge } from '../../../design-system'

// A report deadline beside its due date, on the work list and a client's
// page (CP-18): the Overdue badge once past due, otherwise the countdown,
// amber within three days.
export function DueNote({
  overdue,
  countdown,
}: {
  overdue: boolean
  countdown: { text: string; soon: boolean } | null
}) {
  if (overdue) return <Badge tone="high">Overdue</Badge>
  if (!countdown) return null
  return (
    <span
      style={{
        fontSize: '13px',
        fontWeight: countdown.soon ? '500' : '400',
        color: countdown.soon ? 'var(--status-moderate-fg)' : 'var(--text-muted)',
      }}
    >
      {countdown.text}
    </span>
  )
}
