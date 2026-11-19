import type * as React from 'react'
import { Icon } from '../core/Icon'
export type ComboboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'label' | 'size' | 'required' | 'disabled' | 'style' | 'value' | 'onChange' | 'list'
> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  required?: boolean
  disabled?: boolean
  value: string
  onValueChange: (value: string) => void
  // Suggested values; any other text can still be typed.
  options: string[]
}
import { useId, useState } from 'react'
import { SuggestionList, useSuggestions } from './Suggestions'

// A text field that suggests values as it is typed into, drawn like Select
// rather than by the browser, as a <datalist> is: the suggestions containing
// the text, whatever its case, under the field. Arrow keys move through them,
// Enter takes one and Escape closes them; clicking the field shows them, and
// its chevron lists them all. It follows the ARIA combobox pattern, with the list's
// highlighted row as the input's active descendant, so focus stays in the
// field. The list and its keys are shared with ChipInput (Suggestions.tsx).
function Combobox({
  label,
  hint,
  error,
  size = 'md',
  required = false,
  disabled = false,
  value,
  onValueChange,
  options,
  ...rest
}: ComboboxProps) {
  const id = useId()
  const inputId = id + '-input'
  const descriptionId = id + '-description'
  const [focus, setFocus] = useState(false)
  // The chevron lists every suggestion, whatever is typed, until typing again.
  const [all, setAll] = useState(false)
  const h =
    size === 'sm'
      ? 'var(--control-height-sm)'
      : size === 'lg'
        ? 'var(--control-height-lg)'
        : 'var(--control-height-md)'
  const typed = all ? '' : value.trim().toLowerCase()
  // Only for the field being typed in, never one filled in by other means.
  const list = useSuggestions(options, typed, focus && !disabled)
  const { shown, listId } = list

  const close = () => {
    list.close()
    setAll(false)
  }
  const choose = (option: string) => {
    onValueChange(option)
    setAll(false)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    list.keyDown(event, choose)
    if (event.key === 'Escape' || event.key === 'Tab') setAll(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label ? (
        <label
          htmlFor={inputId}
          style={{
            fontSize: 'var(--text-label-size)',
            lineHeight: 'var(--text-label-lh)',
            fontWeight: 'var(--text-label-weight)',
            color: 'var(--graphite-700)',
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
        </label>
      ) : null}
      <div style={{ position: 'relative' }}>
        <span
          className="ds-field"
          style={{
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
            borderRadius: 'var(--radius-field)',
            boxShadow: focus ? 'var(--focus-ring)' : 'none',
            transition: 'var(--transition-control)',
          }}
        >
          <input
            className="ds-field-input"
            id={inputId}
            {...list.inputProps}
            aria-invalid={!!error}
            aria-describedby={error || hint ? descriptionId : undefined}
            required={required}
            disabled={disabled}
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value)
              list.typing()
              setAll(false)
            }}
            onClick={list.open}
            onKeyDown={onKeyDown}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false)
              close()
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: '100%',
              padding: options.length ? '0 30px 0 10px' : '0 10px',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: 'var(--text-small-size)',
              color: 'var(--text-primary)',
            }}
            {...rest}
          />
          {options.length > 0 && !disabled ? (
            // Lists every suggestion; the keyboard has the arrow keys instead.
            <button
              type="button"
              tabIndex={-1}
              aria-label={shown ? 'Hide suggestions' : 'Show suggestions'}
              aria-expanded={shown}
              aria-controls={listId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                document.getElementById(inputId)?.focus()
                if (shown) close()
                else {
                  setAll(true)
                  list.open()
                }
              }}
              style={{
                position: 'absolute',
                right: 1,
                top: 1,
                bottom: 1,
                width: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <Icon
                name={shown ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={'var(--text-muted)'}
              />
            </button>
          ) : null}
        </span>
        <SuggestionList list={list} label={label} typed={typed} onChoose={choose} />
      </div>
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
    </div>
  )
}
export { Combobox }
