import type * as React from 'react'

export type SwitchProps = {
  label?: React.ReactNode
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  style?: React.CSSProperties
}
function Switch({ label, checked = false, disabled = false, onChange, style = {} }: SwitchProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-body)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      <span className="ds-choice">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 34,
            height: 18,
            flex: '0 0 auto',
            borderRadius: 'var(--radius-pill)',
            background: checked ? 'var(--action-primary)' : 'var(--graphite-300)',
            opacity: disabled ? 0.5 : 1,
            transition: 'background-color var(--duration-fast) var(--ease-standard)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: checked ? 18 : 2,
              width: 14,
              height: 14,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--graphite-0)',
              boxShadow: 'var(--shadow-sm)',
              transition: 'left var(--duration-fast) var(--ease-standard)',
            }}
          />
        </span>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}
export { Switch }
