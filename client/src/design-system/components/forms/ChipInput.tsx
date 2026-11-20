// A field of bubbles, like a mail app's To field (IN-18, NEW pattern): text is typed
// freely, spaces and all, and Enter turns it into a bubble. Its dropdown suggests
// values for the position being typed: `suggest(level, before)` is given that
// position and the bubbles before it, so a caller can offer, say, only the headings
// used under the same parent. Clicking a bubble edits it in place; × and Backspace
// remove; pasted "A > B" or lines split into bubbles. Enter never submits the form
// round it. The list and its keys are Combobox's (Suggestions.tsx).
import type * as React from 'react'
import { useId, useRef, useState } from 'react'
import { Icon } from '../core/Icon'
import { SuggestionList, useSuggestions } from './Suggestions'

export type ChipInputProps = {
  label: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  disabled?: boolean
  placeholder?: string
  value: string[]
  onChange: (value: string[]) => void
  // What one bubble is, for its buttons' names: "Edit heading 8.6 Hangers".
  itemName?: string
  // The values to suggest at `level` (0 = first), given the bubbles before it.
  suggest?: (level: number, before: string[]) => string[]
}

// Pasted text splits on ">" (a typed trail) and on new lines.
const pieces = (text: string) =>
  text
    .split(/>|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)

function ChipInput({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  placeholder,
  value,
  onChange,
  suggest,
  itemName = 'value',
}: ChipInputProps) {
  const id = useId()
  const inputId = id + '-input'
  const descriptionId = id + '-description'
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  // The bubble being edited in place, or null when typing a new one at the end.
  const [editing, setEditing] = useState<number | null>(null)
  // A bubble just opened for editing lists all its level's options until typing changes
  // its text: its own text would filter them all out.
  const [fresh, setFresh] = useState(false)

  const level = editing ?? value.length
  const options = (suggest?.(level, value.slice(0, level)) ?? []).filter(
    // A bubble being edited isn't offered back to itself.
    (o) => editing === null || o !== value[editing],
  )
  const typed = fresh ? '' : text.trim().toLowerCase()
  const list = useSuggestions(options, typed, focus && !disabled)

  // Puts `parts` at the box's position: a new bubble at the end, or in place of the
  // one being edited. Nothing typed adds nothing; an edit emptied removes its bubble.
  const commit = (parts: string[]) => {
    if (editing === null) {
      if (parts.length) onChange([...value, ...parts])
    } else {
      onChange([...value.slice(0, editing), ...parts, ...value.slice(editing + 1)])
      setEditing(null)
    }
    setText('')
  }
  const edit = (index: number) => {
    // Text left in the box is kept first, as leaving the field would.
    if (text.trim() && editing === null) onChange([...value, text.trim()])
    setEditing(index)
    setText(value[index])
    setFresh(true)
    list.close()
  }
  const cancel = () => {
    setEditing(null)
    setText('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (list.keyDown(event, (option) => commit([option]))) return
    if (event.key === 'Enter') {
      // A bubble, never a submitted form.
      event.preventDefault()
      commit(pieces(text).length ? [text.trim()] : [])
    } else if (event.key === 'Escape' && editing !== null) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
    } else if (event.key === 'Backspace' && !text && editing === null && value.length) {
      event.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  const box = (
    <input
      ref={input}
      id={inputId}
      className="ds-chip-box"
      // The box moves into the bubble being edited, so it is focused where it lands.
      autoFocus={editing !== null}
      {...list.inputProps}
      aria-invalid={!!error}
      aria-describedby={error || hint ? descriptionId : undefined}
      required={required && value.length === 0}
      disabled={disabled}
      placeholder={value.length === 0 && editing === null ? placeholder : undefined}
      value={text}
      size={Math.max(8, text.length + 1)}
      onChange={(event) => {
        setText(event.target.value)
        setFresh(false)
        list.typing()
      }}
      onClick={list.open}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData('text')
        if (!/>|\n/.test(pasted)) return
        event.preventDefault()
        commit([...pieces(text), ...pieces(pasted)])
      }}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false)
        list.close()
        // What was typed is kept: a bubble, or the edited one's new text.
        if (text.trim() || editing !== null) commit(text.trim() ? [text.trim()] : [])
      }}
    />
  )

  return (
    <div className="ds-chip-input" data-disabled={disabled || undefined}>
      <label htmlFor={inputId} className="ds-chip-label">
        {label}
        {required ? <span className="ds-chip-required">*</span> : null}
      </label>
      <div style={{ position: 'relative' }}>
        <div
          className="ds-chip-field"
          data-focus={focus || undefined}
          data-error={error ? true : undefined}
          // A click on the field's empty space goes to the box.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              input.current?.focus()
            }
          }}
        >
          <ul className="ds-chip-list" aria-label={`Added to ${label}`}>
            {value.map((chip, index) =>
              index === editing ? (
                <li key={`edit-${index}`} className="ds-chip-slot">
                  {index > 0 && <Sep />}
                  {box}
                </li>
              ) : (
                <li key={`${index}-${chip}`} className="ds-chip-slot">
                  {index > 0 && <Sep />}
                  <span className="ds-chip">
                    <button
                      type="button"
                      className="ds-chip-text"
                      aria-label={`Edit ${itemName} ${chip}`}
                      disabled={disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => edit(index)}
                    >
                      {chip}
                    </button>
                    <button
                      type="button"
                      className="ds-chip-remove"
                      aria-label={`Remove ${itemName} ${chip}`}
                      disabled={disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (editing !== null && editing > index) setEditing(editing - 1)
                        onChange(value.filter((_, i) => i !== index))
                      }}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
          {editing === null && (
            <span className="ds-chip-slot ds-chip-end">
              {value.length > 0 && <Sep />}
              {box}
            </span>
          )}
        </div>
        <SuggestionList
          list={list}
          label={label}
          typed={typed}
          onChoose={(option) => commit([option])}
        />
      </div>
      {error || hint ? (
        <span
          id={descriptionId}
          className="ds-chip-description"
          data-error={error ? true : undefined}
        >
          {error || hint}
        </span>
      ) : null}
    </div>
  )
}

// The mark between two levels.
function Sep() {
  return (
    <span className="ds-chip-sep" aria-hidden="true">
      ›
    </span>
  )
}

export { ChipInput }
