import { Icon } from '../../../design-system'

// A report deadline beside its due date, on the work list and a client's
// page (CP-18): Overdue in red once past due (CP-23), otherwise the
// countdown, amber within three days.
export function DueNote({
  overdue,
  countdown,
}: {
  overdue: boolean
  countdown: { text: string; soon: boolean } | null
}) {
  if (overdue)
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '13px',
          fontWeight: '600',
          color: 'var(--red-600)',
        }}
      >
        <Icon name="circle-alert" size={14} />
        Overdue
      </span>
    )
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
