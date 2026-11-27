// Fact list (v2, NEW pattern): a record's details as label and value pairs, two to a row, with the
// small caps label the client facts and the assessment's Details panel use. Called by the knowledge
// base's document details and the User accounts profile, inside a SidePanel.
import type { ReactNode } from 'react'
import './fact-list.css'

/** Returns the list; its children are Facts. `columns` 1 stacks them. */
export function FactList({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <dl className="ds-facts" data-columns={columns}>
      {children}
    </dl>
  )
}

/** Returns one label and its value; `wide` takes the whole row, `help` sits beside the label. */
export function Fact({
  label,
  help,
  wide,
  children,
}: {
  label: string
  help?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="ds-fact" data-wide={wide || undefined}>
      <dt>
        {label}
        {help}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
