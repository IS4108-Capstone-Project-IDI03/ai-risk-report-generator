import type * as React from 'react'

export type RadioProps = {
  name?: string
  label?: React.ReactNode
  description?: React.ReactNode
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  style?: React.CSSProperties
}
function Radio({
  name,
  label,
  description,
  checked = false,
  disabled = false,
  onChange,
  style = {},
}: RadioProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: description ? 'flex-start' : 'center',
        gap: 'var(--space-4)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-body)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      <span className="ds-choice">
        <input
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            marginTop: description ? 3 : 0,
            flex: '0 0 auto',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid ' + (checked ? 'var(--action-primary)' : 'var(--border-strong)'),
            background: 'var(--surface-card)',
            opacity: disabled ? 0.5 : 1,
            transition: 'var(--transition-control)',
          }}
        >
          {checked ? (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--action-primary)',
              }}
            />
          ) : null}
        </span>
      </span>
      <span>
        <span>{label}</span>
        {description ? (
          <span
            style={{
              display: 'block',
              fontSize: 'var(--text-caption-size)',
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}
export { Radio }
