// "Checklist" (AS-06 canvas C4): the areas that need more opened up side by side, each with what
// is still open (a few, then "+N more" and See all), and the areas that are fine as one even
// row of ticks with their bars. The columns stack on a phone. Used by CardView.tsx.
import { useContext } from 'react'
import { Icon } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { Card } from '../../types'
import { CardShell } from './CardShell'
import { TickCells } from './TickCells'

/** Returns the checklist card. */
export function ChecklistCard({ card }: { card: Extract<Card, { type: 'checklist' }> }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  return (
    <CardShell
      title="Checklist"
      help="Checklist items your observations answer"
      note={`${card.answered} of ${card.total} answered`}
      wide
    >
      {card.gaps.length > 0 && (
        <div className="mbt-gaps">
          {card.gaps.map((g) => (
            <div key={g.area} className="mbt-gap" role="group" aria-label={g.area}>
              <header>
                <span className="mbt-tile" data-tone={g.tone} aria-hidden="true">
                  <Icon name={g.icon} size={16} />
                </span>
                <span>
                  <b>{g.area}</b>
                  <small data-tone={g.tone}>{`${g.covered} of ${g.total}`}</small>
                </span>
              </header>
              <ul>
                {g.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <footer>
                <span>{g.more > 0 ? `+${g.more} more` : ''}</span>
                {!past && (
                  <button
                    type="button"
                    className="mbt-seeall"
                    aria-label={`See all of ${g.area}`}
                    onClick={() => bot.openLink(g.link)}
                  >
                    See All
                    <Icon name="chevron-right" size={14} />
                  </button>
                )}
              </footer>
            </div>
          ))}
        </div>
      )}
      <TickCells cells={card.fine} />
    </CardShell>
  )
}
