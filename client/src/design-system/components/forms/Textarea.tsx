import type * as React from 'react'

export type TextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'label' | 'hint' | 'error' | 'rows' | 'disabled' | 'style'
> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  rows?: number
  disabled?: boolean
  style?: React.CSSProperties
}
import { useId, useState } from 'react'
function Textarea({
  label,
  hint,
  error,
  rows = 4,
  disabled = false,
  style = {},
  ...rest
}: TextareaProps) {
  const descriptionId = useId()
  const [focus, setFocus] = useState(false)
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
      <textarea
        aria-invalid={!!error}
        aria-describedby={error || hint ? descriptionId : undefined}
        rows={rows}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          boxSizing: 'border-box',
          padding: '8px 10px',
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
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-body-size)',
          lineHeight: 'var(--text-body-lh)',
          color: 'var(--text-primary)',
          transition: 'var(--transition-control)',
          ...style,
        }}
        {...rest}
      />
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
export { Textarea }
