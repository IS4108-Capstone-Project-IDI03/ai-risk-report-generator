// Panel (v2, NEW pattern from the CP-29 Insights redesign): one white card with a heading row
// (16 / 700 navy title, an optional help tip beside it, actions at the right) and an optional
// grey note under it, then its content. Every titled card on a screen uses it, so their headings
// line up and share one rhythm. Called by feature screens (clients' Insights tab first).
import { useId, type ReactNode, type Ref } from 'react'
import './panel.css'
// The phone's edge-to-edge look is shared with ListCard.
import './list-card.css'

export type PanelProps = {
  title: ReactNode
  // A leading IconTile before the title (a New Assessment card's client or site).
  icon?: ReactNode
  // Drawn inside the heading right after the title, before the help tip: a count (CountPill).
  after?: ReactNode
  // A (?) help tip, drawn right after the title.
  help?: ReactNode
  // Controls at the right end of the heading row (icon actions, a confidence meter).
  actions?: ReactNode
  // One 12 px grey line under the heading: what the panel holds or how it is ordered.
  note?: ReactNode
  children?: ReactNode
  // The scroll target when a screen brings the panel into view.
  ref?: Ref<HTMLElement>
  className?: string
  // The element: a side card beside the main column is an `aside`.
  as?: 'section' | 'aside'
  // The screen-reader name when the title says more than that (a count): it replaces the title as
  // the panel's name.
  label?: string
  // On a phone the panel runs edge to edge like a ListCard with `bleed` (the Calendar's side cards).
  bleed?: boolean
  // A walkthrough target (F-12).
  'data-walk'?: string
}

/** Returns a titled v2 card: heading row, optional note, then the children. */
export function Panel({
  title,
  icon,
  after,
  help,
  actions,
  note,
  children,
  ref,
  className,
  as: Tag = 'section',
  label,
  bleed,
  'data-walk': walk,
}: PanelProps) {
  const id = useId()
  return (
    <Tag
      ref={ref}
      className={className ? `ds-panel ${className}` : 'ds-panel'}
      aria-labelledby={label ? undefined : id}
      aria-label={label}
      data-bleed={bleed || undefined}
      data-walk={walk}
    >
      <div className="ds-panel-head">
        <div className="ds-panel-bar">
          <span className="ds-panel-title-row">
            {icon ? <span className="ds-panel-icon">{icon}</span> : null}
            <h2 id={id} className="ds-panel-title">
              {title}
              {after ? <span className="ds-panel-after">{after}</span> : null}
            </h2>
            {help}
          </span>
          {actions ? <div className="ds-panel-actions">{actions}</div> : null}
        </div>
        {note ? <p className="ds-panel-note">{note}</p> : null}
      </div>
      {children}
    </Tag>
  )
}
