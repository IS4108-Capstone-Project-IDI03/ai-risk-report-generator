// List toolbar (v2 section 2 "One list frame", shared): the 64 px row at the top of a list card:
// the search, the filter pills, a labelled sort pill, and the main button at the right end.
// A tablet card puts the search and the end on the first row and the pills under them; a phone
// gives the search a full row, the pills one scrolling row and the end a full row, all 44 px.
// Called by the Assessments, Clients, client tabs, Calendar and Knowledge base lists.
import type { ReactNode } from 'react'
import './list-card.css'

export type ListToolbarProps = {
  // A SearchField, first.
  search?: ReactNode
  // Anything between the search and the pills (the Calendar's period stepper and Today).
  children?: ReactNode
  // The filter pills (FilterPill or a menu around one), and any pill-shaped toggles.
  filters?: ReactNode
  // The sort pill: the last of the pills, pushed to the right end on a wide card.
  sort?: ReactNode
  // The right end: the main button (New assessment, Upload), and controls that sit with it.
  end?: ReactNode
  className?: string
  'data-walk'?: string
}

/** Returns the toolbar row with its slots in the v2 order. */
export function ListToolbar({
  search,
  children,
  filters,
  sort,
  end,
  className,
  'data-walk': walk,
}: ListToolbarProps) {
  return (
    <div
      className={className ? `ds-list-toolbar ${className}` : 'ds-list-toolbar'}
      data-walk={walk}
    >
      {search}
      {children}
      {filters || sort ? (
        <div className="ds-list-toolbar-pills">
          {filters}
          {sort ? <span className="ds-list-toolbar-sort">{sort}</span> : null}
        </div>
      ) : null}
      {end ? <div className="ds-list-toolbar-end">{end}</div> : null}
    </div>
  )
}
