// How a turn's pieces are laid out (AS-06, round 8): a run of words shares one speech bubble, so
// a turn reads as one message instead of a stack of boxes; a stand-out message and a card stand
// alone. The first bubble carries the tail. Each of these blocks is one "message" of the
// one-at-a-time reveal (useReveal.ts): in a pushed turn it is drawn only once its turn comes.
// Used by library.tsx's Reply (the AI's program) and TurnBody.tsx (the fallback).
import { useContext, useEffect, type ReactNode } from 'react'
import { RevealContext, SlotContext, TurnContext } from '../../context'
import { Bubble } from './Bubble'

// 'normal' and 'good' words go in a bubble of that colour; 'alone' pieces (cards) draw
// themselves; an 'alert' draws its own bubble, and takes the tail when it comes first.
export type PieceKind = 'normal' | 'good' | 'alone' | 'alert'

/** Returns the pieces in one column, runs of same-toned words grouped into bubbles. */
export function Flow<T>({
  pieces,
  kindOf,
  draw,
}: {
  pieces: T[]
  kindOf: (piece: T) => PieceKind
  draw: (piece: T, index: number) => ReactNode
}) {
  const reveal = useContext(RevealContext)
  const turnId = useContext(TurnContext)?.turn.id
  // F-12: the walkthrough points at MarshBot's latest message, not the buttons under it.
  const newest = useContext(TurnContext)?.newest
  const out: ReactNode[] = []
  let tailed = false
  for (let i = 0; i < pieces.length;) {
    const kind = kindOf(pieces[i])
    const from = i
    if (kind === 'alone' || kind === 'alert') {
      out.push(
        <SlotContext.Provider key={i} value={{ tail: kind === 'alert' && !tailed }}>
          {draw(pieces[i], i)}
        </SlotContext.Provider>,
      )
      if (kind === 'alert') tailed = true
      i += 1
      continue
    }
    const run: ReactNode[] = []
    for (; i < pieces.length && kindOf(pieces[i]) === kind; i += 1)
      run.push(<div key={i}>{draw(pieces[i], i)}</div>)
    out.push(
      <Bubble key={from} tone={kind} tail={!tailed}>
        {run}
      </Bubble>,
    )
    tailed = true
  }
  // A pushed turn tells the queue how many messages it has, and draws only the ones shown. Without
  // the count the queue could not tell when the last one is out, and the choices would never come.
  const queue = reveal && turnId && reveal.fresh.has(turnId) ? reveal : null
  const register = queue?.register
  const count = out.length
  useEffect(() => register?.(turnId!, count), [register, turnId, count])
  return (
    <div className="mbt-flow" data-walk={newest ? 'overview.latest' : undefined}>
      {queue ? out.filter((_, i) => queue.shows(turnId!, i)) : out}
    </div>
  )
}
