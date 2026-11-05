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
import { useEffect, useId, useState } from 'react'

// The typed text in bold where a suggestion contains it.
function Match({ text, typed }: { text: string; typed: string }) {
  const at = typed ? text.toLowerCase().indexOf(typed) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <strong style={{ fontWeight: 'var(--weight-semibold)' }}>
        {text.slice(at, at + typed.length)}
      </strong>
      {text.slice(at + typed.length)}
    </>
  )
}

// A text field that suggests values as it is typed into, drawn like Select
// rather than by the browser, as a <datalist> is: the suggestions containing
// the text, whatever its case, under the field. Arrow keys move through them,
// Enter takes one and Escape closes them; clicking the field shows them, and
// its chevron lists them all. It follows the ARIA combobox pattern, with the list's
// highlighted row as the input's active descendant, so focus stays in the
// field.
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
  const listId = id + '-list'
  const descriptionId = id + '-description'
  const optionId = (index: number) => id + '-option-' + index
  const [focus, setFocus] = useState(false)
  const [open, setOpen] = useState(false)
  // The chevron lists every suggestion, whatever is typed, until typing again.
  const [all, setAll] = useState(false)
  const [active, setActive] = useState(-1)
  const h =
    size === 'sm'
      ? 'var(--control-height-sm)'
      : size === 'lg'
        ? 'var(--control-height-lg)'
        : 'var(--control-height-md)'
  const typed = all ? '' : value.trim().toLowerCase()
  const matches = options.filter((o) => o.toLowerCase().includes(typed))
  // Only for the field being typed in, never one filled in by other means.
  const shown = open && focus && !disabled && matches.length > 0
  const current = shown && active < matches.length ? active : -1

  // The highlighted row stays in view as the arrow keys move past the edge.
  useEffect(() => {
    if (current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' })
  })

  const close = () => {
    setOpen(false)
    setAll(false)
    setActive(-1)
  }
  const choose = (option: string) => {
    onValueChange(option)
    close()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive(shown ? (current + 1) % matches.length : 0)
    } else if (event.key === 'ArrowUp' && shown) {
      event.preventDefault()
      setActive(current <= 0 ? matches.length - 1 : current - 1)
    } else if (event.key === 'Enter' && current >= 0) {
      event.preventDefault()
      choose(matches[current])
    } else if (event.key === 'Escape' && shown) {
      // Closes the list only, not a dialog the field is in.
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') close()
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
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={listId}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            aria-invalid={!!error}
            aria-describedby={error || hint ? descriptionId : undefined}
            // The browser's own suggestions would cover these.
            autoComplete="off"
            required={required}
            disabled={disabled}
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value)
              setOpen(true)
              setAll(false)
              setActive(-1)
            }}
            onClick={() => setOpen(true)}
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
                  setOpen(true)
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
        <ul
          id={listId}
          role="listbox"
          // Its own name, so finding the field by its label finds only the field.
          aria-label={typeof label === 'string' ? 'Suggestions for ' + label : 'Suggestions'}
          hidden={!shown}
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-2))',
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: 240,
            overflowY: 'auto',
            margin: 0,
            padding: 'var(--space-2)',
            listStyle: 'none',
            background: 'var(--surface-card)',
            borderRadius: 'var(--radius-popover)',
            boxShadow: 'var(--shadow-popover)',
          }}
        >
          {shown &&
            matches.map((option, index) => (
              <li
                key={option}
                id={optionId(index)}
                role="option"
                className="ds-combo-option"
                aria-selected={index === current}
                // Keeps focus in the field, so the click lands before it blurs.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-body-size)',
                  lineHeight: 'var(--text-body-lh)',
                  color: 'var(--text-primary)',
                  background: index === current ? 'var(--surface-hover)' : 'transparent',
                  cursor: 'pointer',
                  overflowWrap: 'anywhere',
                }}
              >
                <Match text={option} typed={typed} />
              </li>
            ))}
        </ul>
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
