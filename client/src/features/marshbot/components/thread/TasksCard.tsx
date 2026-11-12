// "To do" (AS-06 canvas C1 to C3): the things to fix now, ticking off in place, "0 of 2 done" on
// the heading. Used by CardView.tsx.
import type { Card } from '../../types'
import { CardRow } from './CardRow'
import { CardShell } from './CardShell'

/** Returns the to-do card. */
export function TasksCard({ card }: { card: Extract<Card, { type: 'tasks' }> }) {
  return (
    <CardShell title={card.title} note={`${card.done} of ${card.total} done`}>
      {card.rows.map((r) => (
        <CardRow key={r.id} row={r} />
      ))}
    </CardShell>
  )
}
