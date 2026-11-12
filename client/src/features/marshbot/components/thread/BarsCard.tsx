// Every checklist area as a bar (AS-06 canvas H1, the catch-up): one segment per item, the
// areas that need more in amber with an arrow to them, the rest ticked. Used by CardView.tsx.
import { useContext } from 'react'
import { Icon, IconButton, Tooltip } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { Card } from '../../types'
import { CardShell } from './CardShell'
import { SegBar } from './SegBar'

/** Returns the checklist bars card. */
export function BarsCard({ card }: { card: Extract<Card, { type: 'bars' }> }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  return (
    <CardShell
      title="Checklist"
      help="Checklist items your observations answer"
      note={`${card.answered} of ${card.total} answered`}
      wide
    >
      <ul className="mbt-bars">
        {card.areas.map((a) => (
          <li key={a.area} data-low={a.low || undefined}>
            <span className="mbt-bars-area">
              <Icon name={a.icon} size={15} />
              {a.area}
            </span>
            <SegBar
              covered={a.covered}
              total={a.total}
              tone={a.low ? 'amber' : 'green'}
              label={`${a.area}: ${a.covered} of ${a.total}`}
            />
            <span className="mbt-bars-count" aria-hidden="true">
              {`${a.covered} of ${a.total}`}
            </span>
            <span className="mbt-bars-end">
              {!a.low ? (
                <span className="mbt-tick" aria-hidden="true">
                  <Icon name="circle-check" size={18} />
                </span>
              ) : past ? null : (
                <Tooltip label="Open in Checklist" placement="top-end">
                  <IconButton
                    icon="chevron-right"
                    label={`Open ${a.area} in the checklist`}
                    tooltip=""
                    className="mbt-open"
                    onClick={() => bot.openLink(a.link)}
                  />
                </Tooltip>
              )}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}
