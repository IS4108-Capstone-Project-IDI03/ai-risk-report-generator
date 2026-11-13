// One turn from MarshBot (AS-06 canvas C1): its face in the turn's mood beside a stack of speech
// bubbles and cards, "MarshBot" above the first turn of a run. A turn pushed in while the screen
// is open (`fresh`) arrives piece by piece (thread.css .mbt-in). Drawn by SessionTurns.tsx.
import type { CSSProperties, ReactNode } from 'react'
import { MarshBotFace } from '../MarshBotFace'
import type { Mood } from '../../types'

/** Returns a bot turn: face, optional name, then `children` (TurnBody or the typing dots). */
export function BotTurn({
  id,
  mood,
  named,
  faced = true,
  fresh = false,
  children,
}: {
  // The turn's id on the page, so the agenda can jump to it (Agenda.tsx).
  id?: string
  mood: Mood
  named: boolean
  // false = a later turn of the same run: the face's column stays, empty, so bubbles line up.
  faced?: boolean
  fresh?: boolean
  children: ReactNode
}) {
  return (
    // A labelled stop for focus: after a reply, focus moves to the newest turn (Thread.tsx).
    <div
      id={id}
      className="mbt-turn"
      role="group"
      aria-label="MarshBot"
      tabIndex={-1}
      data-fresh={fresh || undefined}
      data-grouped={!faced || undefined}
      // Named: the face drops by the name's height, level with the first bubble (thread.css).
      data-named={named || undefined}
    >
      <span className="mbt-face mbt-in" style={{ '--i': 0 } as CSSProperties}>
        {faced && <MarshBotFace mood={mood} decorative />}
      </span>
      <div className="mbt-stack">
        {named && <span className="mbt-who">MarshBot</span>}
        {children}
      </div>
    </div>
  )
}
