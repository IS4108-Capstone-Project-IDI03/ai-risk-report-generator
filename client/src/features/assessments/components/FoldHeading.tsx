import { Icon } from '../../../design-system'

// A group's heading that folds it away: a building on the Observations tab
// (CP-16), a client on the grouped work list (CP-17). Its title and how many
// it holds, read out together as the button's name.
export function FoldHeading({
  title,
  countLabel,
  open,
  controls,
  onToggle,
}: {
  title: string
  countLabel: string
  open: boolean
  // The id of what it folds.
  controls: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={title + ', ' + countLabel}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minHeight: '44px',
        padding: '0 16px',
        textAlign: 'left',
        fontFamily: 'inherit',
        background: 'var(--surface-header)',
        border: 0,
        borderBottom: '1px solid var(--border-default)',
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
}
