// A card on an observation's page (CP-24, design system v2): white, radius 16, its title in 16 / 700
// navy. The page's Recordings, Photos, Handwritten pages and Details are each one.
// Rendered by screens/ObservationPage.tsx and the cards beside it. Styles in observation-page.css.
import type { ReactNode } from 'react'

/** Returns the card; `label` names it for screen readers when the title says more than that (a count). */
export function RecordCard({
  title,
  label = title,
  as: Tag = 'section',
  className,
  children,
}: {
  title: string
  label?: string
  as?: 'section' | 'aside'
  // An extra class, e.g. the Details card's own layout.
  className?: string
  children: ReactNode
}) {
  return (
    <Tag className={className ? `cpp-card ${className}` : 'cpp-card'} aria-label={label}>
      <h3 className="cpp-card-title">{title}</h3>
      {children}
    </Tag>
  )
}
