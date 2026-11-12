// Time in each stage, for an admin (AS-06 canvas S9): one bar split by the days each stage took,
// the current one in navy. Every span names its stage: a short stage keeps the width of its label
// and the long ones give way (cards.css .mbt-time). Used by CardView.tsx.
import type { Card } from '../../types'
import { CardShell } from './CardShell'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Returns the time-in-stage card. */
export function StageTimeCard({ card }: { card: Extract<Card, { type: 'stage-time' }> }) {
  return (
    <CardShell title={card.title} note={card.note} wide>
      {/* The bar is a picture of the list below, so screen readers read the list instead. */}
      <div className="mbt-time" aria-hidden="true">
        {card.spans.map((s) => (
          <span
            key={s.label}
            data-now={s.now || undefined}
            // A stage of zero days still shows as a sliver, so none goes missing.
            style={{ flex: `${Math.max(s.days, 0.4)} 1 0` }}
            title={`${s.label}: ${days(s.days)}`}
          >
            <span className="mbt-time-label">
              <b>{s.label}</b> {`${s.days}d`}
            </span>
          </span>
        ))}
      </div>
      <ul className="mbt-sr">
        {card.spans.map((s) => (
          <li key={s.label}>{`${s.label} ${days(s.days)}${s.now ? ', now' : ''}`}</li>
        ))}
      </ul>
    </CardShell>
  )
}
