import type * as React from 'react'
import { Icon } from './Icon'
export type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'icon' | 'label' | 'size' | 'variant' | 'selected' | 'disabled' | 'style'
> & {
  icon?: string
  label?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: string
  selected?: boolean
  disabled?: boolean
  style?: React.CSSProperties
}
import { useState } from 'react'
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
  size = 'md',
  variant = 'ghost',
  selected = false,
  disabled = false,
  style = {},
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false)
  const s = SIZES[size] || SIZES.md
  const bg = selected
    ? 'var(--surface-selected)'
    : hover && !disabled
      ? 'var(--surface-hover)'
      : variant === 'outline'
        ? 'var(--surface-card)'
        : 'transparent'
  return (
    <button
      type={'button'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        width: s.box,
        height: s.box,
        flex: '0 0 auto',
        borderRadius: 'var(--radius-md)',
        border: variant === 'outline' ? '1px solid var(--border-default)' : '1px solid transparent',
        background: bg,
        color: selected ? 'var(--ink-600)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'var(--transition-control)',
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={s.icon} />
    </button>
  )
}
export { IconButton }
