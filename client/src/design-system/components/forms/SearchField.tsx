// Search field and filter pill (CP-23, board 01): grey-fill controls for table toolbars.
// Called by the Assessments, Clients and client tables. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type SearchFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  // Accessible name; the placeholder is often the same text.
  label?: string
}

/** Returns a 40 px grey search input with a magnifier. */
export function SearchField({ label, className, ...rest }: SearchFieldProps) {
  return (
    <label className={`ds-search ${className ?? ''}`}>
      <Icon name="search" size={16} />
      <input type="search" aria-label={label ?? rest.placeholder} {...rest} />
    </label>
  )
}

export type FilterPillProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  // Current filter text, e.g. "Status" or "Draft".
  label: string
  icon?: string
}

/** Returns a grey pill button with a chevron; the host opens its menu from onClick. */
export function FilterPill({ label, icon, ...rest }: FilterPillProps) {
  return (
    <button type="button" className="ds-filter-pill" {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {label}
      <Icon name="chevron-down" size={16} />
    </button>
  )
}
