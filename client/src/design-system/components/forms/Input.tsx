import type * as React from 'react'
import { Icon } from '../core/Icon'
export type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'label' | 'hint' | 'error' | 'iconLeft' | 'size' | 'required' | 'disabled' | 'style'
> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  iconLeft?: string
  size?: 'sm' | 'md' | 'lg'
  required?: boolean
  disabled?: boolean
  style?: React.CSSProperties
}
import { useId, useState } from 'react'
function Input({
  label,
  hint,
  error,
  iconLeft,
  size = 'md',
  required = false,
  disabled = false,
  style = {},
  ...rest
}: InputProps) {
  const descriptionId = useId()
  const [focus, setFocus] = useState(false)
  const h =
    size === 'sm'
      ? 'var(--control-height-sm)'
      : size === 'lg'
        ? 'var(--control-height-lg)'
        : 'var(--control-height-md)'
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label ? (
        <span
          style={{
            fontSize: 'var(--text-small-size)',
            lineHeight: 'var(--text-small-lh)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-body)',
          }}
        >
          {label}
          {required ? (
            <span
              style={{
                color: 'var(--action-danger)',
                marginLeft: 3,
              }}
            >
              {'*'}
            </span>
          ) : null}
        </span>
      ) : null}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          boxSizing: 'border-box',
          height: h,
          padding: '0 10px',
          background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
          border:
            '1px solid ' +
            (error
              ? 'var(--action-danger)'
              : focus
                ? 'var(--border-focus)'
                : 'var(--border-default)'),
          borderRadius: 'var(--radius-md)',
          boxShadow: focus ? 'var(--focus-ring)' : 'none',
          transition: 'var(--transition-control)',
          ...style,
        }}
      >
        {iconLeft ? <Icon name={iconLeft} size={14} color={'var(--text-muted)'} /> : null}
        <input
          aria-invalid={!!error}
          aria-describedby={error || hint ? descriptionId : undefined}
          required={required}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: 'var(--text-body-size)',
            color: 'var(--text-primary)',
          }}
          {...rest}
        />
      </span>
      {error || hint ? (
        <span
          id={descriptionId}
          style={{
            fontSize: 'var(--text-caption-size)',
            lineHeight: 'var(--text-caption-lh)',
            color: error ? 'var(--action-danger)' : 'var(--text-muted)',
          }}
        >
          {error || hint}
        </span>
      ) : null}
    </label>
  )
}
export { Input }
