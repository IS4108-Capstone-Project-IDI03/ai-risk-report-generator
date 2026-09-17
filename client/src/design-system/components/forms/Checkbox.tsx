import type * as React from 'react'
import { Icon } from '../core/Icon'
export type CheckboxProps = {
  label?: React.ReactNode
  description?: React.ReactNode
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  style?: React.CSSProperties
}
function Checkbox({
  label,
  description,
  checked = false,
  indeterminate = false,
  disabled = false,
  onChange,
  style = {},
}: CheckboxProps) {
  const on = checked || indeterminate
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
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
          ref={(element) => {
            if (element) element.indeterminate = indeterminate
          }}
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
            borderRadius: 'var(--radius-xs)',
            border: '1px solid ' + (on ? 'var(--action-primary)' : 'var(--border-strong)'),
            background: on ? 'var(--action-primary)' : 'var(--surface-card)',
            opacity: disabled ? 0.5 : 1,
            transition: 'var(--transition-control)',
          }}
        >
          {indeterminate ? (
            <Icon name={'minus'} size={12} color={'var(--text-inverse)'} />
          ) : checked ? (
            <Icon name={'check'} size={12} color={'var(--text-inverse)'} />
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
              lineHeight: 'var(--text-caption-lh)',
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
export { Checkbox }
