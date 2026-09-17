import type * as React from 'react'
import { Icon } from './Icon'
export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  | 'variant'
  | 'size'
  | 'iconLeft'
  | 'iconRight'
  | 'disabled'
  | 'loading'
  | 'fullWidth'
  | 'children'
  | 'style'
> & {
  variant?: string
  size?: 'sm' | 'md' | 'lg'
  iconLeft?: string
  iconRight?: string
  disabled?: boolean
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
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  style = {},
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const s = SIZES[size] || SIZES.md
  const p = palette(variant, hover && !disabled, active && !disabled)
  return (
    <button
      type={'button'}
      disabled={disabled || loading}
      onMouseEnter={() => setHover(true)}
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
        borderRadius: 'var(--radius-md)',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: variant === 'primary' || variant === 'danger' ? 'var(--shadow-sm)' : 'none',
        transition: 'var(--transition-control)',
        textDecoration: variant === 'link' && hover ? 'underline' : 'none',
        whiteSpace: 'nowrap',
        ...p,
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <Icon name={'loader-circle'} size={s.icon} />
      ) : iconLeft ? (
        <Icon name={iconLeft} size={s.icon} />
      ) : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
    </button>
  )
}
export { Button }
