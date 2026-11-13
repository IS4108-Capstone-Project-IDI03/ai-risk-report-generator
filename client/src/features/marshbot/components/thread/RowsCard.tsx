// A card of named rows (AS-06 canvas C5, C10, C13, S1 to S3, S8): what needs looking at, and what
// is already fine as a row of ticks underneath. Its `cta` is drawn in the action slot under the
// newest turn (round 7), not in the card. Used by CardView.tsx.
import type { Card } from '../../types'
import { CardRow } from './CardRow'
import { CardShell } from './CardShell'
import { TickCells } from './TickCells'

/** Returns the rows card. */
export function RowsCard({ card }: { card: Extract<Card, { type: 'rows' }> }) {
  // Nothing to draw (an old saved "Export again" answer, whose card held only its button).
  if (!card.rows.length && !card.ticks.length) return null
  return (
    <CardShell title={card.title} note={card.note}>
      {card.rows.map((r) => (
        <CardRow key={r.id} row={r} />
      ))}
      {/* Nothing to do and only what is fine: the ticks get the soft green band (canvas C10). */}
      <TickCells cells={card.ticks} band={!card.rows.length} />
    </CardShell>
  )
}
