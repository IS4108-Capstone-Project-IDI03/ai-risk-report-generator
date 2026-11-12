// One card of a turn, by its type (AS-06): tasks, rows, checklist, bars, outline, lanes or time
// in stage, in its place in the turn so a pushed turn's pieces arrive one after another. A card
// that throws asks the turn for its plain fallback. Drawn by library.tsx's Card and TurnBody.tsx.
import { Component, useContext, type CSSProperties, type ReactNode } from 'react'
import { FailContext, SlotContext, TurnContext } from '../../context'
import type { Card } from '../../types'
import { BarsCard } from './BarsCard'
import { ChecklistCard } from './ChecklistCard'
import { LanesCard } from './LanesCard'
import { OutlineCard } from './OutlineCard'
import { RowsCard } from './RowsCard'
import { StageTimeCard } from './StageTimeCard'
import { TasksCard } from './TasksCard'

// Without this, one broken card would blank the whole Overview.
class CardBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { broken: boolean }
> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('MarshBot card failed', error)
    this.props.onFail()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

function view(card: Card) {
  switch (card.type) {
    case 'tasks':
      return <TasksCard card={card} />
    case 'rows':
      return <RowsCard card={card} />
    case 'checklist':
      return <ChecklistCard card={card} />
    case 'bars':
      return <BarsCard card={card} />
    case 'outline':
      return <OutlineCard card={card} />
    case 'lanes':
      return <LanesCard card={card} />
    case 'stage-time':
      return <StageTimeCard card={card} />
  }
}

/** Returns the card in its slot of the turn. */
export function CardView({ card }: { card: Card }) {
  const slot = useContext(SlotContext)
  const onFail = useContext(FailContext)
  return (
    <div className="mbt-slot mbt-in" style={{ '--i': slot.index } as CSSProperties}>
      <CardBoundary onFail={onFail}>{view(card)}</CardBoundary>
    </div>
  )
}

/** Returns the card with this id in the turn being drawn (OpenUI's Card); nothing if unknown. */
export function CardById({ id }: { id: string }) {
  const card = useContext(TurnContext)?.turn.cards.find((c) => c.id === id)
  return card ? <CardView card={card} /> : null
}
