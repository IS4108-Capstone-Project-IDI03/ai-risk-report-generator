// The outline (AS-06 canvas S4 to S7, G1): every item listed in two columns with its state icon,
// one bar coloured item by item, a key that says each state once, and one button. No row is
// singled out (round 6): the ones needing work show it by their icon and note, and a row with a
// link opens it. An unknown feature's facts come out looking like this too. Used by CardView.tsx.
import { useContext } from 'react'
import { Icon } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { Card, OutlineItem, OutlineState } from '../../types'
import { CardCta, CardShell } from './CardShell'
import { SegBar } from './SegBar'

// Each state's icon, bar colour (cards.css data-state / data-tone) and the word a screen reader
// hears when the card's key doesn't name it.
const LOOK: Record<OutlineState, { icon: string; tone: string | null; word: string }> = {
  ok: { icon: 'circle-check', tone: 'green', word: 'Done' },
  wait: { icon: 'circle-alert', tone: 'amber', word: 'Decisions to Make' },
  question: { icon: 'circle-help', tone: 'amber', word: 'Questions for You' },
  figures: { icon: 'calculator', tone: 'ink', word: 'Needs Your Figures' },
  bad: { icon: 'circle-x', tone: 'red', word: 'Failed' },
  new: { icon: 'circle-dashed', tone: null, word: 'Not Started' },
}

// One line of the outline; a line with a link opens it, except in an earlier session. Its state
// is said in words too ("3, Opportunities for Improvement, Reviewed"): the icon alone would leave
// screen-reader users, and anyone whose icons fail to load, without it.
function Line({ item, word }: { item: OutlineItem; word: string }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  const link = past ? null : item.link
  const body = (
    <>
      <span className="mbt-ol-no">
        {item.no}
        <span className="mbt-sr">,</span>
      </span>
      <span className="mbt-ol-st" data-state={item.state}>
        <Icon name={LOOK[item.state].icon} size={18} />
      </span>
      <span className="mbt-ol-title">
        {item.title}
        <span className="mbt-sr">{`, ${word}${item.note ? ',' : ''}`}</span>
      </span>
      {item.note && <span className="mbt-ol-note">{item.note}</span>}
    </>
  )
  return (
    <li className="mbt-ol" data-state={item.state}>
      {link ? (
        <button type="button" onClick={() => bot.openLink(link)}>
          {body}
        </button>
      ) : (
        <div>{body}</div>
      )}
    </li>
  )
}

/** Returns the outline card. */
export function OutlineCard({ card }: { card: Extract<Card, { type: 'outline' }> }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  const half = Math.ceil(card.items.length / 2)
  const columns = [card.items.slice(0, half), card.items.slice(half)]
  return (
    <CardShell title={card.title} wide>
      <div className="mbt-ol-lead">
        <b>{card.lead}</b>
        <SegBar parts={card.items.map((i) => LOOK[i.state].tone)} />
      </div>
      <div className="mbt-ol-cols">
        {columns.map((col, c) => (
          <ul key={c}>
            {col.map((item) => (
              <Line
                key={item.no}
                item={item}
                word={card.key.find((k) => k.state === item.state)?.label ?? LOOK[item.state].word}
              />
            ))}
          </ul>
        ))}
      </div>
      {card.key.length > 0 && (
        <ul className="mbt-ol-key">
          {card.key.map((k) => (
            <li key={k.state}>
              <span className="mbt-ol-st" data-state={k.state}>
                <Icon name={LOOK[k.state].icon} size={15} />
              </span>
              {k.label}
            </li>
          ))}
        </ul>
      )}
      <CardCta cta={card.cta} past={past} onOpen={bot.openLink} />
    </CardShell>
  )
}
