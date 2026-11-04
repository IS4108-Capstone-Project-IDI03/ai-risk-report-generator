import type * as React from 'react'
import { Icon } from './Icon'
import { ReasonWrap } from '../feedback/ReasonBox'
import type { Reason } from '../feedback/ReasonBox'
export type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'icon' | 'label' | 'size' | 'variant' | 'selected' | 'disabled' | 'style'
> & {
  icon?: string
  label?: string
  // The hover text when it should be shorter than label, the screen-reader name: "Rename
  // client" over "Rename client Northgate Freight Group" (round 16).
  tooltip?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: string
  selected?: boolean
  disabled?: boolean
  // Blocked but still focusable: greyed out, click does nothing, and a reason box explains why.
  disabledReason?: Reason
  style?: React.CSSProperties
}
const SIZES = {
  sm: {
    box: 'var(--control-height-sm)',
    icon: 14,
  },
  md: {
    box: 'var(--control-height-md)',
    icon: 16,
  },
  lg: {
    box: 'var(--control-height-lg)',
    icon: 18,
  },
}
function IconButton({
  icon,
  label,
  tooltip,
  size = 'md',
  variant = 'ghost',
  selected = false,
  disabled = false,
  disabledReason,
  onClick,
  children,
  style = {},
  className,
  ...rest
}: IconButtonProps) {
  const s = SIZES[size] || SIZES.md
  // A plain ghost button takes its hover colour from the surface (cp23.css); selected, outline
  // and caller-coloured ones keep their own background.
  const ghost = !selected && variant !== 'outline' && !style.background && !style.backgroundColor
  const bg = selected
    ? 'var(--surface-selected)'
    : variant === 'outline'
      ? 'var(--surface-card)'
      : undefined
  const blocked = disabled || !!disabledReason
  return (
    <ReasonWrap reason={disabledReason}>
      {(describedBy, onBlockedClick) => (
        <button
          type={'button'}
          aria-label={label}
          title={disabledReason ? undefined : (tooltip ?? label)}
          disabled={disabled}
          aria-disabled={disabledReason ? true : undefined}
          aria-describedby={describedBy}
          data-selected={selected ? '' : undefined}
          data-ghost={ghost ? '' : undefined}
          onClick={
            disabledReason
              ? (e) => {
                  e.preventDefault()
                  onBlockedClick()
                }
              : onClick
          }
          // A caller's class adds to ours, so the kit's base and hover still apply.
          className={className ? `ds-icon-button ${className}` : 'ds-icon-button'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            width: s.box,
            height: s.box,
            flex: '0 0 auto',
            borderRadius: 'var(--radius-md)',
            border:
              variant === 'outline' ? '1px solid var(--border-default)' : '1px solid transparent',
            background: bg,
            color: selected ? 'var(--ink-600)' : 'var(--text-secondary)',
            cursor: blocked ? 'not-allowed' : 'pointer',
            opacity: blocked ? 0.45 : 1,
            ...style,
          }}
          {...rest}
        >
          <Icon name={icon} size={s.icon} />
          {children}
        </button>
      )}
    </ReasonWrap>
  )
}
export { IconButton }
