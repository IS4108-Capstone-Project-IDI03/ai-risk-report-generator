import type * as React from 'react'
import { Icon } from './Icon'
import { ReasonWrap } from '../feedback/ReasonBox'
import type { Reason } from '../feedback/ReasonBox'
export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  | 'variant'
  | 'size'
  | 'iconLeft'
  | 'iconRight'
  | 'disabled'
  | 'disabledReason'
  | 'loading'
  | 'fullWidth'
  | 'children'
  | 'style'
> & {
  // Also: `create` (navy pill with the v2 shadow) and `pill` (grey secondary pill).
  variant?: string
  // Rounds any variant to a pill (radius 999).
  pill?: boolean
  size?: 'sm' | 'md' | 'lg'
  iconLeft?: string
  iconRight?: string
  disabled?: boolean
  // Blocked but still focusable: greyed out, click does nothing, and a reason box explains why.
  disabledReason?: Reason
  loading?: boolean
  fullWidth?: boolean
  children?: React.ReactNode
  style?: React.CSSProperties
}
import { useState } from 'react'
const SIZES = {
  sm: {
    height: 'var(--control-height-sm)',
    padding: '0 10px',
    font: 'var(--text-small-size)',
    icon: 14,
  },
  md: {
    height: 'var(--control-height-md)',
    padding: '0 14px',
    font: 'var(--text-body-size)',
    icon: 16,
  },
  lg: {
    height: 'var(--control-height-lg)',
    padding: '0 18px',
    font: 'var(--text-body-lg-size)',
    icon: 18,
  },
}
function palette(variant: string, hover: boolean, active: boolean) {
  switch (variant) {
    // The screen's Create button: navy pill with a soft shadow (v2 section 5).
    case 'create':
      return {
        background: active
          ? 'var(--action-primary-active)'
          : hover
            ? 'var(--action-primary-hover)'
            : 'var(--action-primary)',
        color: 'var(--text-inverse)',
        border: '1px solid transparent',
      }
    // Secondary grey pill: filters, "Documents · 3".
    case 'pill':
      return {
        background: active
          ? 'var(--graphite-200)'
          : hover
            ? 'var(--graphite-200)'
            : 'var(--graphite-100)',
        color: 'var(--graphite-900)',
        border: '1px solid transparent',
      }
    case 'primary':
      return {
        background: active
          ? 'var(--action-primary-active)'
          : hover
            ? 'var(--action-primary-hover)'
            : 'var(--action-primary)',
        color: 'var(--text-inverse)',
        border: '1px solid transparent',
      }
    case 'danger':
      return {
        background: active
          ? 'var(--oxblood-700)'
          : hover
            ? 'var(--oxblood-600)'
            : 'var(--action-danger)',
        color: 'var(--text-inverse)',
        border: '1px solid transparent',
      }
    // A row-level action that should stand out without competing with the
    // screen's one primary button, e.g. Edit details in the knowledge base.
    case 'tonal':
      return {
        background: active ? 'var(--ink-200)' : hover ? 'var(--ink-100)' : 'var(--ink-50)',
        color: 'var(--ink-700)',
        border: '1px solid ' + (hover ? 'var(--ink-300)' : 'var(--ink-200)'),
      }
    // The soft red of `tonal`, for a row-level action that takes something out
    // of use, e.g. Withdraw in the knowledge base. The colours match the
    // danger Callout; solid `danger` stays for the confirm button.
    case 'danger-tonal':
      return {
        background: 'var(--red-50)',
        color: 'var(--action-danger)',
        border: '1px solid ' + (hover || active ? 'var(--action-danger)' : '#f0d4d4'),
      }
    // Red text and the soft red edge of `danger-tonal`, no fill: a rare,
    // irreversible row action set apart from the row's others (see
    // docs/design-system.md).
    case 'danger-outline':
      return {
        background: active || hover ? 'var(--red-50)' : 'transparent',
        color: 'var(--action-danger)',
        border: '1px solid ' + (hover || active ? 'var(--action-danger)' : '#f0d4d4'),
      }
    case 'ghost':
      return {
        background: active
          ? 'var(--surface-active)'
          : hover
            ? 'var(--surface-hover)'
            : 'transparent',
        color: 'var(--text-body)',
        border: '1px solid transparent',
      }
    case 'link':
      return {
        background: 'transparent',
        color: 'var(--text-link)',
        border: '1px solid transparent',
      }
    default:
      return {
        background: active
          ? 'var(--surface-active)'
          : hover
            ? 'var(--surface-hover)'
            : 'var(--surface-card)',
        color: 'var(--text-body)',
        border: '1px solid ' + (hover ? 'var(--border-strong)' : 'var(--border-default)'),
      }
  }
}
function Button({
  variant = 'secondary',
  pill = false,
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  disabledReason,
  onClick,
  loading = false,
  fullWidth = false,
  children,
  style = {},
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const s = SIZES[size] || SIZES.md
  const blocked = disabled || !!disabledReason
  const p = palette(variant, hover && !blocked, active && !blocked)
  return (
    <ReasonWrap reason={disabledReason}>
      {(describedBy, onBlockedClick) => (
        <button
          type={'button'}
          className="ds-press"
          disabled={disabled || loading}
          aria-disabled={disabledReason ? true : undefined}
          aria-describedby={describedBy}
          onClick={
            disabledReason
              ? (e) => {
                  e.preventDefault()
                  onBlockedClick()
                }
              : onClick
          }
          // No hover colour on touch screens, where a tap would leave it stuck on.
          onMouseEnter={() => setHover(window.matchMedia?.('(hover: hover)').matches !== false)}
          onMouseLeave={() => {
            setHover(false)
            setActive(false)
          }}
          onMouseDown={() => setActive(true)}
          onMouseUp={() => setActive(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            boxSizing: 'border-box',
            height: s.height,
            padding: variant === 'link' ? 0 : s.padding,
            width: fullWidth ? '100%' : undefined,
            fontFamily: 'var(--font-sans)',
            fontSize: s.font,
            fontWeight: 'var(--weight-medium)',
            lineHeight: 1,
            letterSpacing: '0.005em',
            borderRadius:
              pill || variant === 'create' || variant === 'pill'
                ? 'var(--radius-pill)'
                : 'var(--radius-md)',
            cursor: blocked || loading ? 'not-allowed' : 'pointer',
            opacity: blocked ? 0.45 : 1,
            // Only Create floats (v2 section 5); every other button sits flat.
            boxShadow: variant === 'create' ? 'var(--shadow-create)' : 'none',
            // Press feedback is CSS (.ds-press:active in kit.css): scale 0.97, none with reduced motion.
            transition: 'var(--transition-control), transform var(--duration-fast) var(--ease-out)',
            textDecoration: variant === 'link' && hover ? 'underline' : 'none',
            whiteSpace: 'nowrap',
            ...p,
            ...style,
          }}
          {...rest}
        >
          {loading ? (
            <Icon
              name={'loader-circle'}
              size={s.icon}
              style={{ animation: 'dsSpin 0.9s linear infinite' }}
            />
          ) : iconLeft ? (
            <Icon name={iconLeft} size={s.icon} />
          ) : null}
          {children}
          {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
        </button>
      )}
    </ReasonWrap>
  )
}
export { Button }
