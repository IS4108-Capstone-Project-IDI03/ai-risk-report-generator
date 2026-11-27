// A round icon action with its tooltip (v2 section 2, "Icons first for actions"): a 32 px round
// icon button that names its action on hover and focus, or, when blocked, greys out and explains
// why in a reason box instead. With `href` it is the same button as a link that opens in a new
// tab. The one round icon action in the app: rows, cards and panels all use it (the clients'
// RowAction and the knowledge base's RowIconButton were merged into it).
// Called by feature screens. Calls IconButton, Icon, Tooltip.
import type * as React from 'react'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Tooltip } from '../feedback/Tooltip'
import type { Reason } from '../feedback/ReasonBox'

export type IconActionProps = {
  icon: string
  // The accessible name, naming the item for a screen reader ("Edit Site").
  label: string
  // The hover text: the action alone. Defaults to label.
  tooltip?: string
  // Where the tooltip sits; bottom for a control at the top edge of a scrolling box.
  placement?: string
  size?: 'sm' | 'md'
  // A soft grey disc behind the icon, for an action that must read as a button on its own (an
  // add beside a heading). Plain ones stay bare until hovered.
  shaded?: boolean
  // Red, for a bin (v2: bins are red, every other icon is quiet grey).
  danger?: boolean
  disabled?: boolean
  // Blocked but focusable: the reason box replaces the tooltip.
  disabledReason?: Reason
  // Busy: the icon becomes a spinner and the button ignores presses until the work is done. It
  // stays focusable (aria-disabled), so a keyboard user's focus is not dropped.
  loading?: boolean
  // A link that opens in a new tab (Directions) in place of a button.
  href?: string
  onClick?: () => void
  // A walkthrough target (F-12), set on the button or link itself.
  'data-walk'?: string
  // A show/hide toggle: whether its region is shown, and that region's id (button form only).
  'aria-expanded'?: boolean
  'aria-controls'?: string
  className?: string
  style?: React.CSSProperties
}

/** Returns a round icon button wrapped in a design-system tooltip (or carrying a reason box when blocked). */
export function IconAction({
  icon,
  label,
  tooltip = label,
  placement = 'top',
  size = 'sm',
  shaded = false,
  danger = false,
  disabled,
  disabledReason,
  loading = false,
  href,
  onClick,
  'data-walk': walk,
  'aria-expanded': expanded,
  'aria-controls': controls,
  className,
  style,
}: IconActionProps) {
  // `shaded` is a class, on the button and on the link form alike.
  const classes = `${shaded ? 'ds-icon-button--shaded ' : ''}${className ?? ''}`.trim()
  // v2 "Muted": icon buttons are --graphite-600; a caller's style still wins.
  const tone = { color: danger ? 'var(--red-600)' : 'var(--graphite-600)', ...style }
  // Stopped here, so a row that opens on click doesn't also open from its own icon. The
  // walkthrough listens in the capture phase, so it still sees the press.
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const link = href ? (
    <a
      className={`ds-icon-button ds-icon-link${classes ? ' ' + classes : ''}`}
      data-ghost=""
      data-walk={walk}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label + ', opens in a new tab'}
      onClick={stop}
      // `md` matches the 40 px button form (a panel header's Close beside it).
      style={size === 'md' ? { width: 40, height: 40, ...tone } : tone}
    >
      <Icon name={icon} size={size === 'md' ? 16 : 14} />
    </a>
  ) : null
  const button = link ?? (
    <IconButton
      icon={loading ? 'loader-circle' : icon}
      label={label}
      size={size}
      disabled={disabled}
      // Spread after the button's own, so it repeats the blocked state a reason box sets.
      aria-disabled={loading || disabledReason ? true : undefined}
      aria-busy={loading || undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      disabledReason={disabledReason}
      data-walk={walk}
      onClick={(e) => {
        stop(e)
        if (!loading) onClick?.()
      }}
      // Clears the native title so it never stacks on the tooltip.
      title={undefined}
      className={classes || undefined}
      style={{ borderRadius: 999, ...tone }}
    />
  )
  // A reason box already explains a blocked control; a tooltip on top would double it.
  if (disabledReason) return button
  return (
    <Tooltip label={tooltip} placement={placement} style={{ display: 'flex' }}>
      {button}
    </Tooltip>
  )
}
