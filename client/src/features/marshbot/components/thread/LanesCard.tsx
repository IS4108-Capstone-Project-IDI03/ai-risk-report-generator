// An admin's view of the sections (AS-06 canvas S9, round 7): only the lanes the gateway sends,
// each state said once in its heading (a solid icon, a coloured count pill), then one small card
// per section with its date and open comments, a solid green tick on the reviewed ones. A lane of more than 6 takes 2 columns of cards and twice the width, so no lane
// runs long. The lanes stack on a phone. Used by CardView.tsx.
import type { CSSProperties } from 'react'
import { Icon } from '../../../../design-system'
import type { Card } from '../../types'
import { shortDay } from '../../format'
import { CardShell } from './CardShell'
import { DoneTick } from './DoneTick'

type LaneState = 'wait' | 'new' | 'ok'
// Past this many sections a lane's cards go 2 abreast.
const TWO_COLUMNS_FROM = 7

// A section's date: a day from the gateway shows as "27 Nov", drafted ones "Drafted 27 Nov".
function when(date: string | null, state: LaneState) {
  if (!date) return null
  const day = /^\d{4}-\d{2}-\d{2}/.test(date) ? shortDay(date.slice(0, 10)) : date
  return state === 'new' ? `Drafted ${day}` : day
}

// A lane's header icon, solid: an amber disc with "!", a grey disc with a minus, a green tick.
function LaneIcon({ state }: { state: LaneState }) {
  if (state === 'ok') return <DoneTick size={18} />
  return (
    <span className="mbt-lane-ico" data-state={state} aria-hidden="true">
      {state === 'wait' ? '!' : <Icon name="minus" size={12} color="var(--text-inverse)" />}
    </span>
  )
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
              <LaneIcon state={lane.state} />
              {lane.label}
              <span className="mbt-lane-n">{lane.items.length}</span>
            </h4>
            <ul className="mbt-lane-cards">
              {lane.items.map((s) => (
                <li key={s.no} className="mbt-lane-card">
                  <span className="mbt-ol-no">{s.no}</span>
                  <span className="mbt-lane-title">{s.title}</span>
                  {/* Comments, date and tick drop under a short title rather than squeeze it. */}
                  <span className="mbt-lane-meta">
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
                    {lane.state === 'ok' && <DoneTick size={16} />}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </CardShell>
  )
}
