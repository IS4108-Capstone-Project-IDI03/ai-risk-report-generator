// The outline (AS-06 canvas S4 to S7, G1, round 7): every item listed in two columns with its
// state icon and one bar coloured item by item; the key that says each state once sits in the
// free cell under the right column. Its `cta` is drawn in the action slot under the newest turn.
// Rows that need the engineer (questions, figures, decisions, a failure) get a soft wash; a row
// with a link opens it. An unknown feature's facts come out looking like this too. Used by CardView.tsx.
import { useContext } from 'react'
import { Icon } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { Card, OutlineItem, OutlineState } from '../../types'
import { CardShell } from './CardShell'
import { DoneTick } from './DoneTick'
import { SegBar } from './SegBar'

// Each state's icon, bar colour (cards.css data-state / data-tone) and the word a screen reader
// hears when the card's key doesn't name it. A done row's icon is the solid DoneTick instead.
const LOOK: Record<OutlineState, { icon?: string; tone: string | null; word: string }> = {
  ok: { tone: 'green', word: 'Done' },
  wait: { icon: 'circle-alert', tone: 'amber', word: 'Decisions to Make' },
  question: { icon: 'circle-help', tone: 'amber', word: 'Questions for You' },
  figures: { icon: 'calculator', tone: 'amber', word: 'Needs Your Figures' },
  bad: { icon: 'circle-x', tone: 'red', word: 'Failed' },
  new: { icon: 'circle-dashed', tone: null, word: 'Not Started' },
}

// A row's side note, or nothing. The state icon and the key already say "Scores", "3 questions",
// "2 comments"; only a note that says something else stays ("Waits on 4"). Without this rule every
// row would repeat its own state beside it.
function sideNote(note: string | null) {
  return note && /^waits\b/i.test(note) ? note : null
}

// Where a row needs the engineer: amber for questions, figures and decisions, red for a failure.
// An undrafted section is amber only when it is the one left and nothing waits on it, since then
// it is the next thing to do.
function attention(item: OutlineItem, items: OutlineItem[]) {
  if (item.state === 'bad') return 'red'
  if (item.state === 'wait' || item.state === 'question' || item.state === 'figures') return 'amber'
  const lone = items.filter((i) => i.state === 'new').length === 1
  return item.state === 'new' && lone && !sideNote(item.note) ? 'amber' : null
}

// A state's icon at the row-icon size, solid green for done.
function StateIcon({ state }: { state: OutlineState }) {
  return (
    <span className="mbt-ol-st" data-state={state}>
      {state === 'ok' ? <DoneTick size={18} /> : <Icon name={LOOK[state].icon} size={18} />}
    </span>
  )
}

// One line of the outline; a line with a link opens it, except in an earlier session. Its state
// is said in words too ("3, Opportunities for Improvement, Reviewed"): the icon alone would leave
// screen-reader users, and anyone whose icons fail to load, without it.
function Line({ item, word, items }: { item: OutlineItem; word: string; items: OutlineItem[] }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  const link = past ? null : item.link
  const note = sideNote(item.note)
  const body = (
    <>
      <span className="mbt-ol-no">
        {item.no}
        <span className="mbt-sr">,</span>
      </span>
      <StateIcon state={item.state} />
      <span className="mbt-ol-title">
        {item.title}
        <span className="mbt-sr">{`, ${word}${note ? ',' : ''}`}</span>
      </span>
      {note && <span className="mbt-ol-note">{note}</span>}
    </>
  )
  return (
    <li className="mbt-ol" data-state={item.state} data-attn={attention(item, items)}>
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

// The key: each state once, one compact line.
function Key({ keys }: { keys: { state: OutlineState; label: string }[] }) {
  return (
    <ul className="mbt-ol-key">
      {keys.map((k) => (
        <li key={k.state}>
          <StateIcon state={k.state} />
          {k.label}
        </li>
      ))}
    </ul>
  )
}

/** Returns the outline card. */
export function OutlineCard({ card }: { card: Extract<Card, { type: 'outline' }> }) {
  const half = Math.ceil(card.items.length / 2)
  const columns = [card.items.slice(0, half), card.items.slice(half)]
  // The key takes the free cell at the foot of the right column (a shorter column, an odd count)
  // when it has 3 entries or fewer; a longer key would wrap to 2 lines in the cell, and with an
  // even count there is no free cell, so it goes on its own line under the list.
  const freeCell = columns[1].length < columns[0].length && card.key.length <= 3
  // One state needs no key; the gateway still sends it, so each row keeps its word ("Reviewed").
  const key = card.key.length > 1 && <Key keys={card.key} />
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
                items={card.items}
                word={card.key.find((k) => k.state === item.state)?.label ?? LOOK[item.state].word}
              />
            ))}
            {c === 1 && freeCell && key && <li className="mbt-ol-keycell">{key}</li>}
          </ul>
        ))}
      </div>
      {!freeCell && key}
    </CardShell>
  )
}
