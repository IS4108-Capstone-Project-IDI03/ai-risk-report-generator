// A card of named rows (AS-06 canvas C5, C10, C13, S1 to S3, S8): what needs looking at, what is
// already fine as a row of ticks underneath, and at most one button. Used by CardView.tsx.
import { useContext } from 'react'
import { TurnContext, useMarshBot } from '../../context'
import type { Card } from '../../types'
import { CardRow } from './CardRow'
import { CardCta, CardShell } from './CardShell'
import { TickCells } from './TickCells'

/** Returns the rows card. */
export function RowsCard({ card }: { card: Extract<Card, { type: 'rows' }> }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  return (
    <CardShell title={card.title} note={card.note}>
      {card.rows.map((r) => (
        <CardRow key={r.id} row={r} />
      ))}
      {/* Nothing to do and only what is fine: the ticks get the soft green band (canvas C10). */}
      <TickCells cells={card.ticks} band={!card.rows.length} />
      <CardCta cta={card.cta} past={past} onOpen={bot.openLink} />
    </CardShell>
  )
}
