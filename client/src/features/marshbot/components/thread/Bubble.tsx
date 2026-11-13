// MarshBot's words (AS-06 canvas C1; one message per turn, round 8): a run of words shares ONE
// speech bubble (white, green for good news, amber for a stand-out message), the first of a turn
// with a tail towards the face. Inside it: an optional lead line (the takeaway), paragraphs and a
// tick list. A name wrapped in **…** shows bold, and opens the thing it names when one of the
// turn's cards lists it. Drawn by Flow.tsx for library.tsx's Lead, Say and Ticks, by Alert.tsx,
// and for TurnBody's fallback.
import { useContext, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../../../../design-system'
import { MarshBotContext, TurnContext } from '../../context'
import type { Card, ItemLink } from '../../types'

// Where each named thing of a card goes, by its name in lower case: a row, a checklist area, a
// section of the outline. Without a link (a done row), the name stays plain bold.
function linksOf(cards: Card[]): Map<string, ItemLink> {
  const links = new Map<string, ItemLink>()
  const add = (name: string, link: ItemLink | null | undefined) => {
    if (link && !links.has(name.toLowerCase())) links.set(name.toLowerCase(), link)
  }
  for (const card of cards) {
    if (card.type === 'tasks' || card.type === 'rows')
      card.rows.forEach((r) => add(r.title, 'link' in r.end ? r.end.link : null))
    if (card.type === 'checklist') card.gaps.forEach((g) => add(g.area, g.link))
    if (card.type === 'bars') card.areas.forEach((a) => add(a.area, a.link))
    if (card.type === 'outline') card.items.forEach((i) => add(i.title, i.link))
  }
  return links
}

// "**Fire Protection** is at 4 of 12" as text and bold runs; a bold name one of this turn's
// cards lists is a link straight to it (not in an earlier session, which is read-only).
// A `**` with no partner shows its tail as plain words, so one stray mark can't bold the rest.
export function Runs({ text }: { text: string }) {
  const bot = useContext(MarshBotContext)
  const turn = useContext(TurnContext)
  const links = bot && turn && !turn.past ? linksOf(turn.turn.cards) : null
  const runs = text.split('**')
  const unclosed = runs.length % 2 === 0
  return runs.map((run, i) => {
    if (!(i % 2) || (unclosed && i === runs.length - 1)) return run
    const link = links?.get(run.toLowerCase())
    // A span, not a <button>: a button is always inline-block, so a name that wraps would
    // jump to its own line and strand the words around it (thread.css .mbt-name).
    return link ? (
      <span
        key={i}
        role="button"
        tabIndex={0}
        className="mbt-name"
        onClick={() => bot!.openLink(link)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          bot!.openLink(link)
        }}
      >
        {run}
      </span>
    ) : (
      <b key={i}>{run}</b>
    )
  })
}

/** Returns `text` as paragraphs, split on blank lines. */
export function Words({ text }: { text: string }) {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p, i) => (
      <p key={i}>
        <Runs text={p} />
      </p>
    ))
}

/** Returns the lead line: the bold first line of the message. */
export function LeadLine({ text }: { text: string }) {
  return (
    <p className="mbt-lead">
      <Runs text={text} />
    </p>
  )
}

/** Returns the ticked items (already sorted), one tick each, inside the bubble. */
export function TickList({ items }: { items: string[] }) {
  return (
    <ul className="mbt-list">
      {items.map((item, i) => (
        <li key={i}>
          <span className="mbt-list-mark" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
          <span>
            <Runs text={item} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Returns one speech bubble round `children`; `index` is its place in the turn's entrance. */
export function Bubble({
  tone,
  tail,
  index,
  children,
}: {
  tone: 'normal' | 'good' | 'alert'
  tail: boolean
  index: number
  children: ReactNode
}) {
  return (
    <div
      className="mbt-bubble mbt-in"
      data-tone={tone}
      data-tail={tail || undefined}
      style={{ '--i': index } as CSSProperties}
    >
      {children}
    </div>
  )
}
