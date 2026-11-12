// What one bot turn shows (AS-06): the wording AI's OpenUI program drawn by OpenUI 1.1.0's
// Renderer with MarshBot's library, or, when there is none, it doesn't parse cleanly, or a piece
// throws, the turn's says then its cards. Either way each piece knows its place, for the tail and
// the stagger, and all sit in one column (thread.css .mbt-flow). Called by BotTurn.tsx.
// Calls library.tsx.
import { Renderer } from 'openui-lang-v1'
import { Component, useState, type ReactNode } from 'react'
import { FailContext, SlotContext } from '../../context'
import { marshbotLibrary, programCards } from '../../library'
import type { Turn } from '../../types'
import { Bubble } from './Bubble'
import { CardView } from './CardView'

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

// The fallback: every say as a bubble (the first with the tail), then every card.
function Plain({ turn }: { turn: Turn }) {
  return (
    <>
      {turn.says.map((say, i) => (
        <SlotContext.Provider key={`s${i}`} value={{ index: i, tail: i === 0 }}>
          <Bubble {...say} />
        </SlotContext.Provider>
      ))}
      <Cards cards={turn.cards} from={turn.says.length} />
    </>
  )
}

/** Returns the turn's bubbles and cards, from its program when it has a good one. */
export function TurnBody({ turn }: { turn: Turn }) {
  // Set once the program throws or OpenUI reports an error: the plain says take over for good.
  const [failed, setFailed] = useState(false)
  const drawn = failed ? null : programCards(turn)
  if (!drawn)
    return (
      <div className="mbt-flow">
        <Plain turn={turn} />
      </div>
    )
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
