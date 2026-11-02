// One row of a sidebar (CP-22): a name with an optional fold arrow and
// trailing badge, plus small actions shown on hover or keyboard focus. Shared
// by the Observations tab's location navigator and a site walk proposal's
// navigator, so both look the same.
import type { ReactNode } from 'react'
import { Icon } from '../../../design-system'

export function NavRow({
  selected,
  label,
  onPick,
  fold,
  actions,
  depth = 0,
  all,
  badge,
}: {
  selected: boolean
  label: string
  onPick: () => void
  fold?: { open: boolean; toggle: () => void }
  actions?: ReactNode
  // How far down the tree: 0 for buildings, 1 for levels, 2 for their locations.
  depth?: number
  // "All locations": the default, set apart from the buildings under it.
  all?: boolean
  // After the name: a count, or a mark that something here needs attention.
  badge?: ReactNode
}) {
  return (
    <div
      className={'ob-nav-row' + (all ? ' ob-nav-all' : '')}
      data-selected={selected || undefined}
      style={{ ['--depth' as string]: depth }}
    >
      {fold && (
        <button
          type="button"
          className="ob-nav-fold"
          aria-expanded={fold.open}
          aria-label={(fold.open ? 'Fold ' : 'Unfold ') + label}
          onClick={fold.toggle}
        >
          <Icon name={fold.open ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
      )}
      <button
        type="button"
        className="ob-nav-pick"
        aria-current={selected || undefined}
        onClick={onPick}
      >
        <span>{label}</span>
        {badge}
      </button>
      {!!actions && <span className="ob-nav-actions">{actions}</span>}
    </div>
  )
}

// A small icon button on a row, e.g. Edit; its label is its tooltip.
export function NavAction({
  icon,
  color,
  label,
  onClick,
}: {
  icon: string
  color: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="ob-nav-action"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={15} color={color} />
    </button>
  )
}
