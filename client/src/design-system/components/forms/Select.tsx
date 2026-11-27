// Select: the one dropdown field, never the browser's native select. A v2 field (40 px, radius 10;
// 44 px on touch) with a chevron that opens our own list (ChoiceMenu): icons, a tick on the chosen
// row, arrow keys, Home/End and type-ahead, floating over dialogs and scrolling boxes, a bottom
// sheet on a phone. Same props as the native one it replaced, so callers read e.target.value.
import { isValidElement, useId, useState, type ReactNode } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { ChoiceMenu, type Choice } from './ChoiceMenu'

export type SelectOption =
  string | { value: string; label: string; icon?: string; disabled?: boolean }
// Options listed under a heading, e.g. by building.
export type SelectOptionGroup = { label: string; options: SelectOption[] }
export type SelectProps = {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  options?: (SelectOption | SelectOptionGroup)[]
  value?: string
  // Called with an event whose target carries the chosen value, as a native select's did.
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  // Shown in grey while the value is none of the options.
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  required?: boolean
  disabled?: boolean
  // On the field's box (New Assessment's amber Not sure tint).
  style?: React.CSSProperties
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

const choiceOf = (o: SelectOption, group?: string): Choice =>
  typeof o === 'string' ? { value: o, label: o, group } : { ...o, group }

// The words of a label given as an element (New Assessment wraps its label in a span), for the
// list's name and the phone sheet's title.
const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : isValidElement<{ children?: ReactNode }>(node)
        ? textOf(node.props.children)
        : ''

/** Returns the labelled field with its list, hint or error line. */
function Select({
  label,
  hint,
  error,
  options = [],
  value = '',
  onChange,
  placeholder = 'Choose',
  size = 'md',
  required = false,
  disabled = false,
  style = {},
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SelectProps) {
  const ownId = useId()
  const buttonId = id ?? ownId
  const descriptionId = useId()
  const [focus, setFocus] = useState(false)
  const choices = options.flatMap((o) =>
    typeof o !== 'string' && 'options' in o
      ? o.options.map((g) => choiceOf(g, o.label))
      : [choiceOf(o)],
  )
  const chosen = choices.find((c) => c.value === value)
  const name = ariaLabel ?? textOf(label)
  const h =
    size === 'sm'
      ? 'var(--control-height-sm)'
      : size === 'lg'
        ? 'var(--control-height-lg)'
        : 'var(--control-height-md)'
  // shortcut: only target/currentTarget value are real, which is all any caller reads.
  const choose = (next: string) => {
    const target = { value: next }
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>)
  }
  return (
    <div
      className="ds-select"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        minWidth: 0,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label ? (
        <label
          htmlFor={buttonId}
          style={{
            fontSize: 'var(--text-label-size)',
            lineHeight: 'var(--text-label-lh)',
            fontWeight: 'var(--text-label-weight)',
            color: 'var(--graphite-700)',
          }}
        >
          {label}
          {required ? (
            // Hidden from the name: aria-required on the field says it.
            <span aria-hidden="true" style={{ color: 'var(--action-danger)', marginLeft: 3 }}>
              {'*'}
            </span>
          ) : null}
        </label>
      ) : null}
      <ChoiceMenu
        label={name}
        listbox
        fixed
        className="ds-select-anchor"
        choices={choices}
        selected={[value]}
        onChoose={choose}
        trigger={(open, toggle) => (
          <button
            type="button"
            id={buttonId}
            role="combobox"
            className="ds-field ds-select-button"
            aria-label={ariaLabel}
            aria-required={required || undefined}
            aria-invalid={!!error}
            aria-describedby={describedBy ?? (error || hint ? descriptionId : undefined)}
            disabled={disabled}
            onClick={toggle}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              boxSizing: 'border-box',
              width: '100%',
              height: h,
              padding: 0,
              background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
              border:
                '1px solid ' +
                (error
                  ? 'var(--action-danger)'
                  : focus || open
                    ? 'var(--border-focus)'
                    : 'var(--border-default)'),
              borderRadius: 'var(--radius-field)',
              boxShadow: (focus || open) && !error ? 'var(--focus-ring)' : 'none',
              transition: 'var(--transition-control)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              ...style,
            }}
          >
            <span
              className="ds-field-input"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minWidth: 0,
                padding: '0 30px 0 10px',
                fontSize: 'var(--text-small-size)',
                textAlign: 'left',
                color: chosen ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {chosen?.icon ? <Icon name={chosen.icon} size={16} color={chosen.color} /> : null}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {chosen?.label ?? placeholder}
              </span>
            </span>
            <Icon
              name={'chevron-down'}
              size={14}
              color={'var(--text-muted)'}
              style={{ position: 'absolute', right: 10, pointerEvents: 'none' }}
            />
          </button>
        )}
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
    </div>
  )
}
export { Select }
