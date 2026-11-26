// MarshBot's words arriving letter by letter (F-12, motion rows 1 and 2): typing dots first, then
// each letter fades in 14 ms after the last (80 ms each), with a 120 ms breath before each new
// paragraph or bullet, capped at 2.4 s; a bullet's dot comes with its own first letter.
// Called by WalkthroughBubble. Calls TypingDots. The whole message is read out once (sr-only copy).
import { useEffect, useState, type CSSProperties } from 'react'
import { TypingDots } from '../../../design-system'
import { blocksOf, plainOf, type Block } from './words'

const GAP_MS = 14
const BREATH_MS = 120
const MAX_MS = 2400

/** Returns the message, revealing itself letter by letter after `typing` ms; `onDone` fires when the last letter is in. */
export function TypedText({
  say,
  typing,
  instant,
  onDone,
}: {
  say: string
  typing: number
  // Every letter at once (reduced motion, or a press on the bubble).
  instant: boolean
  onDone: () => void
}) {
  const blocks = blocksOf(say)
  const letters = blocks.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.text.length, 0), 0)
  const gap = Math.min(GAP_MS, MAX_MS / Math.max(letters, 1))
  const total = typing + letters * gap + (blocks.length - 1) * BREATH_MS
  const [dots, setDots] = useState(typing > 0 && !instant)

  // The dots give way to the letters; onDone once the last letter has started.
  useEffect(() => {
    if (instant) return onDone()
    const hide = setTimeout(() => setDots(false), typing)
    const done = setTimeout(onDone, total)
    return () => (clearTimeout(hide), clearTimeout(done))
  }, [instant, typing, total, onDone])

  let n = 0
  const at = (b: number) => typing + n * gap + b * BREATH_MS
  const paragraph = (block: Block, b: number) =>
    block.runs.map((run, r) => {
      const chars = [...run.text].map((ch, c) => (
        <span key={c} className="wt-ch" style={{ animationDelay: `${at(b) + c * gap}ms` }}>
          {ch}
        </span>
      ))
      n += run.text.length
      return run.bold ? <b key={r}>{chars}</b> : <span key={r}>{chars}</span>
    })

  // Bullets that follow each other share one list: groups of block numbers.
  const groups: number[][] = []
  blocks.forEach((block, b) => {
    const last = groups[groups.length - 1]
    if (block.bullet && last && blocks[last[0]].bullet) last.push(b)
    else groups.push([b])
  })

  return (
    <div className="wt-typed" data-instant={instant || undefined}>
      <span className="ds-sr-only">{plainOf(say)}</span>
      <div aria-hidden="true">
        {groups.map((group) =>
          blocks[group[0]].bullet ? (
            <ul key={group[0]}>
              {group.map((b) => (
                <li key={b} style={{ '--d': `${at(b)}ms` } as CSSProperties}>
                  {paragraph(blocks[b], b)}
                </li>
              ))}
            </ul>
          ) : (
            <p key={group[0]}>{paragraph(blocks[group[0]], group[0])}</p>
          ),
        )}
      </div>
      {/* Not once every letter shows (a press during the dots): they would sit over the first word. */}
      {dots && !instant && <TypingDots />}
    </div>
  )
}
