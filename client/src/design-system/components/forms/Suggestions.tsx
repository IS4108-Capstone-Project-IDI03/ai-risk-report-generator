// The suggestion list under a typed field, shared by Combobox and ChipInput: the
// suggestions containing the typed text (any case, the match in bold), arrow keys
// to move, Enter to take one, Escape to close. It follows the ARIA combobox
// pattern: the field keeps focus and names the highlighted row as its active
// descendant. Not exported from the design system; the fields are.
import type * as React from 'react'
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

/**
 * Returns the list's state for `options` filtered by `typed` (lower-cased, '' for all).
 * `live` is whether the field can show it (focused, not disabled). `keyDown` handles
 * the list's keys and says whether it did; `onChoose` is called with the picked one.
 */
export function useSuggestions(options: string[], typed: string, live: boolean) {
  const id = useId()
  const listId = id + '-list'
  const optionId = (index: number) => id + '-option-' + index
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = options.filter((o) => o.toLowerCase().includes(typed))
  const shown = open && live && matches.length > 0
  const current = shown && active < matches.length ? active : -1

  // The highlighted row stays in view as the arrow keys move past the edge.
  useEffect(() => {
    if (current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' })
  })

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  // Typing shows the list again, nothing highlighted.
  const typing = () => {
    setOpen(true)
    setActive(-1)
  }
  const keyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    onChoose: (option: string) => void,
  ): boolean => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive(shown ? (current + 1) % matches.length : 0)
      return true
    }
    if (event.key === 'ArrowUp' && shown) {
      event.preventDefault()
      setActive(current <= 0 ? matches.length - 1 : current - 1)
      return true
    }
    if (event.key === 'Enter' && current >= 0) {
      event.preventDefault()
      onChoose(matches[current])
      close()
      return true
    }
    if (event.key === 'Escape' && shown) {
      // Closes the list only, not a dialog the field is in.
      event.preventDefault()
      event.stopPropagation()
      close()
      return true
    }
    if (event.key === 'Tab') close()
    return false
  }
  // The attributes the field's input takes, as the combobox that controls the list.
  const inputProps = {
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': shown,
    'aria-controls': listId,
    'aria-activedescendant': current >= 0 ? optionId(current) : undefined,
    // The browser's own suggestions would cover these.
    autoComplete: 'off',
  }
  return {
    listId,
    optionId,
    matches,
    shown,
    current,
    open: () => setOpen(true),
    close,
    typing,
    setActive,
    keyDown,
    inputProps,
  }
}

/** Returns the list under the field, as a listbox named after the field's label. */
export function SuggestionList({
  list,
  label,
  typed,
  onChoose,
}: {
  list: ReturnType<typeof useSuggestions>
  label: React.ReactNode
  typed: string
  onChoose: (option: string) => void
}) {
  const { listId, optionId, matches, shown, current } = list
  return (
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
            onMouseEnter={() => list.setActive(index)}
            onClick={() => {
              onChoose(option)
              list.close()
            }}
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
  )
}
