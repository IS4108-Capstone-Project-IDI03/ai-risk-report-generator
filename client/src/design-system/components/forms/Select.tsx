import type * as React from 'react'
import { Icon } from '../core/Icon'
export type SelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'label' | 'hint' | 'error' | 'options' | 'size' | 'disabled' | 'style'
> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  options?: (string | { value: string; label: string })[]
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  style?: React.CSSProperties
}
import { useId, useState } from 'react'
function Select({
  label,
  hint,
  error,
  options = [],
  size = 'md',
  disabled = false,
  style = {},
  ...rest
}: SelectProps) {
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
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-body)',
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          boxSizing: 'border-box',
          height: h,
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
        <select
          aria-invalid={!!error}
          aria-describedby={error || hint ? descriptionId : undefined}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            appearance: 'none',
            width: '100%',
            height: '100%',
            padding: '0 30px 0 10px',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: 'var(--text-body-size)',
            color: 'var(--text-primary)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
          {...rest}
        >
          {options.map((o) => {
            const value = typeof o === 'string' ? o : o.value
            const text = typeof o === 'string' ? o : o.label
            return (
              <option key={value} value={value}>
                {text}
              </option>
            )
          })}
        </select>
        <Icon
          name={'chevron-down'}
          size={14}
          color={'var(--text-muted)'}
          style={{
            position: 'absolute',
            right: 10,
            pointerEvents: 'none',
          }}
        />
      </span>
      {error || hint ? (
        <span
          id={descriptionId}
          style={{
            fontSize: 'var(--text-caption-size)',
            color: error ? 'var(--action-danger)' : 'var(--text-muted)',
          }}
        >
          {error || hint}
        </span>
      ) : null}
    </label>
  )
}
export { Select }
