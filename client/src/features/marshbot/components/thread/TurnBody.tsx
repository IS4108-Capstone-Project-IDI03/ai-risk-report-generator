// What one bot turn shows (AS-06): the wording AI's OpenUI program drawn by OpenUI 1.1.0's
// Renderer with MarshBot's library, or, when there is none, it doesn't parse cleanly, or a piece
// throws, the turn's says then its cards. Either way the pieces go through Flow.tsx: a run of
// words shares one bubble, a stand-out message and a card stand alone, all in one column
// (thread.css .mbt-flow). Called by BotTurn.tsx. Calls library.tsx.
import { Renderer } from 'openui-lang-v1'
import { Component, useState, type ReactNode } from 'react'
import { FailContext, SlotContext } from '../../context'
import { marshbotLibrary, programCards } from '../../library'
import type { Card, Say, Turn } from '../../types'
import { Alert } from './Alert'
import { LeadLine, TickList, Words } from './Bubble'
import { CardView } from './CardView'
import { Flow, type PieceKind } from './Flow'

// A program that throws while drawing falls back; without this the whole Overview would blank.
class ProgramBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { broken: boolean }
> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('MarshBot turn fell back to its plain words', error)
    this.props.onFail()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

// Cards drawn after everything else, from slot `from` on.
function Cards({ cards, from }: { cards: Turn['cards']; from: number }) {
  return cards.map((card, i) => (
    <SlotContext.Provider key={card.id} value={{ index: from + i, tail: false }}>
      <CardView card={card} />
    </SlotContext.Provider>
  ))
}

// The fallback draws what the program would: the lead line, plain words and a run of ticks in one
// bubble, good news in a green one, an alert in its own, then every card.
type Piece = { say: Say } | { ticks: string[] } | { card: Card }
const kindOf = (p: Piece): PieceKind =>
  'card' in p
    ? 'alone'
    : 'ticks' in p
      ? 'normal'
      : p.say.tone === 'alert'
        ? 'alert'
        : p.say.tone === 'good'
          ? 'good'
          : 'normal'

// The says in order, with neighbouring ticks gathered into one list.
function piecesOf(turn: Turn): Piece[] {
  const out: Piece[] = []
  for (const say of turn.says) {
    const last = out.at(-1)
    if (say.tone !== 'tick') out.push({ say })
    else if (last && 'ticks' in last) last.ticks.push(say.text)
    else out.push({ ticks: [say.text] })
  }
  return [...out, ...turn.cards.map((card) => ({ card }))]
}

function Plain({ turn }: { turn: Turn }) {
  return (
    <Flow
      pieces={piecesOf(turn)}
      kindOf={kindOf}
      draw={(p) =>
        'card' in p ? (
          <CardView card={p.card} />
        ) : 'ticks' in p ? (
          <TickList items={p.ticks} />
        ) : p.say.tone === 'alert' ? (
          <Alert text={p.say.text} />
        ) : p.say.tone === 'lead' ? (
          <LeadLine text={p.say.text} />
        ) : (
          <Words text={p.say.text} />
        )
      }
    />
  )
}

/** Returns the turn's bubbles and cards, from its program when it has a good one. */
export function TurnBody({ turn }: { turn: Turn }) {
  // Set once the program throws or OpenUI reports an error: the plain says take over for good.
  const [failed, setFailed] = useState(false)
  const drawn = failed ? null : programCards(turn)
  if (!drawn) return <Plain turn={turn} />
  // Said stays said (rule 8): cards are rebuilt live, so one the program doesn't name (added
  // since) is drawn after its words, and one it names that has gone draws nothing.
  const extra = turn.cards.filter((c) => !drawn.includes(c.id))
  return (
    <div className="mbt-flow">
      <FailContext.Provider value={() => setFailed(true)}>
        <ProgramBoundary onFail={() => setFailed(true)}>
          <Renderer
            response={turn.program}
            library={marshbotLibrary}
            isStreaming={false}
            onError={(errors) => {
              if (errors.some((e) => e.severity !== 'warning')) setFailed(true)
            }}
          />
        </ProgramBoundary>
      </FailContext.Provider>
      <Cards cards={extra} from={drawn.length + turn.says.length} />
    </div>
  )
}
