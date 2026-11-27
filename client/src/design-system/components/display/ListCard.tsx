// List card (v2 section 2 "One list frame", shared): the one white card every list screen draws its
// records in: an optional toolbar (ListToolbar), the rows, then the footer line (TableFooter) above
// a hairline. Also an optional titled heading, for a card of flush rows (Export's Left to finish).
// It is a size container ("ds-list"), so a table inside lays itself out by the card's own width.
// Called by the Assessments, Clients, Calendar, Knowledge base, Usage and Export screens.
import type { ReactNode } from 'react'
import './list-card.css'

export type ListCardProps = {
  // Search, filters and the main button above the rows: a ListToolbar.
  toolbar?: ReactNode
  // A 16 / 700 navy heading over flush rows, in place of a toolbar.
  title?: ReactNode
  // The heading's id, when something else is labelled by it.
  titleId?: string
  // One 13 px grey line under the title (Export's report facts).
  note?: ReactNode
  // The count line under the rows: a TableFooter.
  footer?: ReactNode
  children?: ReactNode
  // The screen-reader name of the card.
  label?: string
  // On a phone the card runs edge to edge: no side borders or corners (the Clients and
  // Assessments lists, board 21).
  bleed?: boolean
  // The element: a list item when the card is one of a list of cards (the client's Sites).
  as?: 'section' | 'div' | 'li'
  className?: string
  'data-walk'?: string
  'aria-labelledby'?: string
}

/** Returns the list frame: toolbar or title, the rows, then the footer. */
export function ListCard({
  toolbar,
  title,
  titleId,
  note,
  footer,
  children,
  label,
  bleed,
  as: Tag = 'div',
  className,
  'data-walk': walk,
  'aria-labelledby': labelledBy,
}: ListCardProps) {
  return (
    <Tag
      className={className ? `ds-list-card ${className}` : 'ds-list-card'}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-bleed={bleed || undefined}
      data-walk={walk}
    >
      {title ? (
        <div className="ds-list-card-head">
          <h2 className="ds-list-card-title" id={titleId}>
            {title}
          </h2>
          {note ? <p className="ds-list-card-note">{note}</p> : null}
        </div>
      ) : null}
      {toolbar}
      {children}
      {footer}
    </Tag>
  )
}
