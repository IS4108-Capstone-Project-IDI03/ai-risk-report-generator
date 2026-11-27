// A card on an observation's page (CP-24, design system v2): the design system's Panel, so its
// frame and 16 / 700 navy title match every titled card. The page's Recordings, Photos,
// Handwritten pages, Note, Tags and Details are each one. Rendered by screens/ObservationPage.tsx
// and the cards beside it. Its contents' styles are in observation-page.css (.cpp-card).
import type { ReactNode } from 'react'
import { Panel } from '../../../design-system'

/** Returns the card; `label` names it for screen readers when the title says more than that (a count). */
export function RecordCard({
  title,
  label = title,
  as = 'section',
  className,
  actions,
  children,
}: {
  title: string
  label?: string
  as?: 'section' | 'aside'
  // An extra class, e.g. the Details card's own layout.
  className?: string
  // A control at the title's right (the Note card's Dictate button).
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Panel
      as={as}
      title={title}
      label={label}
      actions={actions}
      className={className ? `cpp-card ${className}` : 'cpp-card'}
    >
      {children}
    </Panel>
  )
}
