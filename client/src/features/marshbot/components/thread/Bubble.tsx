// One of MarshBot's speech bubbles (AS-06 canvas C1): white, or green for a 'good' one, sized to
// its words, the first of a turn with a tail towards the face. A blank line starts a paragraph;
// names the rules wrap in **…** show bold. Drawn by library.tsx's Say and TurnBody's fallback.
import { useContext, type CSSProperties } from 'react'
import { SlotContext } from '../../context'
import type { Say } from '../../types'

// "**Fire Protection** is at 4 of 12" as text and bold runs.
function Runs({ text }: { text: string }) {
  return text.split('**').map((run, i) => (i % 2 ? <b key={i}>{run}</b> : run))
}

/** Returns the bubble for `text`, its paragraphs split on blank lines. */
export function Bubble({ text, tone }: Say) {
  const slot = useContext(SlotContext)
  return (
    <div
      className="mbt-bubble mbt-in"
      data-tone={tone}
      data-tail={slot.tail || undefined}
      style={{ '--i': slot.index } as CSSProperties}
    >
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i}>
            <Runs text={p} />
          </p>
        ))}
    </div>
  )
}
