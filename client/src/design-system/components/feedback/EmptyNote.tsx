// Empty note (shared): the one quiet grey line a screen shows when a list has nothing yet, or while
// it loads ("None yet", "Loading your clients…"). Inline it is 13 px; `centred` it fills a card's
// body (14 / 600, 24 px above and below), where a full EmptyState would be too much. A screen with
// an icon, a title and an action uses EmptyState instead. Called by list cards and side panels.
import type { ReactNode } from 'react'
import './empty-note.css'

/** Returns the grey note; `status` reads it out as it changes (a loading line). */
export function EmptyNote({
  children,
  centred,
  status,
  className,
}: {
  children: ReactNode
  centred?: boolean
  status?: boolean
  className?: string
}) {
  return (
    <p
      className={className ? `ds-empty-note ${className}` : 'ds-empty-note'}
      data-centred={centred || undefined}
      role={status ? 'status' : undefined}
    >
      {children}
    </p>
  )
}
