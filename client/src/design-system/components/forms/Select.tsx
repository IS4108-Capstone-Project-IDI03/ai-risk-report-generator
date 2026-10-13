import type * as React from 'react'
import { Icon } from '../core/Icon'
export type SelectOption = string | { value: string; label: string }
// Options listed under a heading (a native optgroup), e.g. by building.
export type SelectOptionGroup = { label: string; options: SelectOption[] }
export type SelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'label' | 'hint' | 'error' | 'options' | 'size' | 'disabled' | 'style'
> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  options?: (SelectOption | SelectOptionGroup)[]
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  style?: React.CSSProperties
}
import { useId, useState } from 'react'
function renderOption(o: SelectOption) {
  const value = typeof o === 'string' ? o : o.value
  return (
    <option key={value} value={value}>
      {typeof o === 'string' ? o : o.label}
    </option>
  )
}
function Select({
  label,
  hint,
  error,
  options = [],
  size = 'md',
  required = false,
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
          required={required}
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
          {options.map((o) =>
            typeof o !== 'string' && 'options' in o ? (
              <optgroup key={'group:' + o.label} label={o.label}>
                {o.options.map(renderOption)}
              </optgroup>
            ) : (
              renderOption(o)
            ),
          )}
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
