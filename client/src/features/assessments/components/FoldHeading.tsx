import type { ReactNode } from 'react'
import { Icon } from '../../../design-system'

// A group's heading that folds it away: a building on the Observations tab
// (CP-16), a client on the grouped work list (CP-17). Its title and how many
// it holds, read out together as the button's name. An action, e.g. a
// client's View client (CP-18), sits beside the button, not inside it, since
// the button folds the group.
export function FoldHeading({
  title,
  countLabel,
  open,
  controls,
  onToggle,
  action,
}: {
  title: string
  countLabel: string
  open: boolean
  // The id of what it folds.
  controls: string
  onToggle: () => void
  action?: ReactNode
}) {
  const fold = (
    <button
      type="button"
      aria-label={title + ', ' + countLabel}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        // Beside an action, a long title wraps rather than running under it.
        ...(action && { flexWrap: 'wrap', flex: '1', minWidth: 0 }),
        gap: action ? '0 8px' : '8px',
        width: '100%',
        minHeight: '44px',
        padding: action ? '6px 8px 6px 16px' : '0 16px',
        textAlign: 'left',
        fontFamily: 'inherit',
        background: action ? 'transparent' : 'var(--surface-header)',
        border: 0,
        borderBottom: action ? 0 : '1px solid var(--border-default)',
        cursor: 'pointer',
      }}
    >
      <Icon
        name={open ? 'chevron-down' : 'chevron-right'}
        size={16}
        color="var(--text-secondary)"
      />
      <span
        style={{
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{countLabel}</span>
    </button>
  )
  if (!action) return fold
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--surface-header)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {fold}
      <span style={{ flex: '0 0 auto', paddingRight: '8px' }}>{action}</span>
    </div>
  )
}
