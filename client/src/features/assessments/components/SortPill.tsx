// The labelled Sort pill (CP-23 round 12, board 03): arrows icon, the current order in words,
// chevron. Used by the Assessments toolbar and the Clients list (clients/components/SortMenu).
// Calls Icon; the host opens its menu from onClick.
import type * as React from 'react'
import { Icon } from '../../../design-system'

/** Returns a grey pill button naming the current sort, e.g. "Report due, earliest first". */
export function SortPill({
  name,
  label,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  // What is sorted, for the accessible name ("Sort assessments").
  name: string
  // The current order, as the menu words it.
  label: string
}) {
  return (
    <button
      type="button"
      className="ds-filter-pill at-sort"
      aria-label={`${name}: ${label}`}
      title={label}
      {...rest}
    >
      <Icon name="arrow-up-down" size={16} />
      <span className="at-sort-label">{label}</span>
      {/* On a mid-width card only the part before the comma shows (assessment-list.css). */}
      <span className="at-sort-short" aria-hidden="true">
        {label.split(',')[0]}
      </span>
      <Icon name="chevron-down" size={16} />
    </button>
  )
}
