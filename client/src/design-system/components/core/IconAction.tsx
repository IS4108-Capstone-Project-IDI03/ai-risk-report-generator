// A round icon action with its tooltip (v2 section 2, "Icons first for actions"): a 32 px round
// icon button that names its action on hover and focus, or, when blocked, greys out and explains
// why in a reason box instead. With `href` it is the same button as a link that opens in a new
// tab. AS-06's Details panel uses it for close, directions, add and edit.
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
  disabled?: boolean
  // Blocked but focusable: the reason box replaces the tooltip.
  disabledReason?: Reason
  // Busy: the icon becomes a spinner and the button ignores presses until the work is done. It
  // stays focusable (aria-disabled), so a keyboard user's focus is not dropped.
  loading?: boolean
  // A link that opens in a new tab (Directions) in place of a button.
  href?: string
  onClick?: () => void
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
  disabled,
  disabledReason,
  loading = false,
  href,
  onClick,
  className,
  style,
}: IconActionProps) {
  const link = href ? (
    <a
      className={`ds-icon-button ds-icon-link${className ? ' ' + className : ''}`}
      data-ghost=""
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      style={style}
    >
      <Icon name={icon} size={14} />
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
      disabledReason={disabledReason}
      onClick={loading ? undefined : onClick}
      // Clears the native title so it never stacks on the tooltip.
      title={undefined}
      className={className}
      style={{ borderRadius: 999, ...style }}
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
