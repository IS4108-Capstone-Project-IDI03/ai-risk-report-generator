// Search field and filter pill (CP-23, board 01): grey-fill controls for table toolbars.
// Called by the Assessments, Clients and client tables. Calls Icon.
import { useState } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type SearchFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  // Accessible name; the placeholder is often the same text.
  label?: string
  // Controls inside the field's right end, e.g. how to search (IN-17's Words | Meaning).
  end?: React.ReactNode
  // The field's data-walk tag (F-12), on its outer box so a walkthrough highlights the whole field.
  walk?: string
}

/** Returns a 40 px grey search input with a magnifier, and `end` inside its right end. */
export function SearchField({ label, className, end, walk, onBlur, ...rest }: SearchFieldProps) {
  // Focus that came from a click or tap: kit.css then shows no ring (the keyboard keeps it).
  const [pointer, setPointer] = useState(false)
  const field = (
    <>
      <Icon name="search" size={16} />
      <input
        type="search"
        aria-label={label ?? rest.placeholder}
        onBlur={(e) => {
          setPointer(false)
          onBlur?.(e)
        }}
        {...rest}
      />
    </>
  )
  const box = {
    'data-walk': walk,
    'data-pointer': pointer ? '' : undefined,
    onPointerDown: () => setPointer(true),
  }
  if (!end)
    return (
      <label className={`ds-search ${className ?? ''}`} {...box}>
        {field}
      </label>
    )
  // The end's controls stay outside the label, so they are never part of the input's name.
  return (
    <div className={`ds-search has-end ${className ?? ''}`} {...box}>
      <label className="ds-search-input">{field}</label>
      <div className="ds-search-end">{end}</div>
    </div>
  )
}

export type FilterPillProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  // Current filter text, e.g. "Status" or "Draft".
  label: string
  icon?: string
  // A filter is chosen: the pill takes the ink tint, so a set filter reads at a glance.
  active?: boolean
}

/** Returns a grey pill button with a chevron (ink when `active`); the host opens its menu from onClick. */
export function FilterPill({ label, icon, active, ...rest }: FilterPillProps) {
  return (
    <button
      type="button"
      className="ds-filter-pill"
      data-active={active ? '' : undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {/* Its own box, so a long choice ends in "…" instead of pushing the pill off a phone. */}
      <span className="ds-filter-pill-label">{label}</span>
      <Icon name="chevron-down" size={16} />
    </button>
  )
}
