// An admin's view of the sections (AS-06 canvas S9, S9b): only the lanes the gateway sends, each
// state said once in its heading with a count, then one small card per section with its date and
// open comments. A lane of more than 6 takes 2 columns of cards and twice the width, so no lane
// runs long. The lanes stack on a phone. Used by CardView.tsx.
import type { CSSProperties } from 'react'
import { Icon } from '../../../../design-system'
import type { Card } from '../../types'
import { shortDay } from '../../format'
import { CardShell } from './CardShell'

const ICON = { wait: 'circle-alert', new: 'circle-dashed', ok: 'circle-check' } as const
// Past this many sections a lane's cards go 2 abreast.
const TWO_COLUMNS_FROM = 7

// A section's date: a day from the gateway shows as "27 Nov", drafted ones "Drafted 27 Nov".
function when(date: string | null, state: keyof typeof ICON) {
  if (!date) return null
  const day = /^\d{4}-\d{2}-\d{2}/.test(date) ? shortDay(date.slice(0, 10)) : date
  return state === 'new' ? `Drafted ${day}` : day
}

/** Returns the lanes card. */
export function LanesCard({ card }: { card: Extract<Card, { type: 'lanes' }> }) {
  return (
    <CardShell title={card.title} note={card.note} wide>
      <div
        className="mbt-lanes"
        style={
          {
            '--cols': card.lanes
              .map((l) => `minmax(0, ${l.items.length >= TWO_COLUMNS_FROM ? 2 : 1}fr)`)
              .join(' '),
          } as CSSProperties
        }
      >
        {card.lanes.map((lane) => (
          <section
            key={lane.state}
            className="mbt-lane"
            data-state={lane.state}
            data-wide={lane.items.length >= TWO_COLUMNS_FROM || undefined}
          >
            <h4>
              <Icon name={ICON[lane.state]} size={16} />
              {lane.label}
              <span className="mbt-lane-n">{lane.items.length}</span>
            </h4>
            <ul className="mbt-lane-cards">
              {lane.items.map((s) => (
                <li key={s.no} className="mbt-lane-card">
                  <span className="mbt-ol-no">{s.no}</span>
                  <span className="mbt-lane-title">{s.title}</span>
                  {s.comments > 0 && (
                    <span
                      className="mbt-lane-cm"
                      title={`${s.comments} open comment${s.comments === 1 ? '' : 's'}`}
                    >
                      <Icon name="message-square" size={14} />
                      {s.comments}
                      {/* The title only reaches a mouse; this tells everyone else what "2" is. */}
                      <span className="mbt-sr">{` open comment${s.comments === 1 ? '' : 's'}`}</span>
                    </span>
                  )}
                  {when(s.date, lane.state) && (
                    <span className="mbt-lane-date">{when(s.date, lane.state)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </CardShell>
  )
}
