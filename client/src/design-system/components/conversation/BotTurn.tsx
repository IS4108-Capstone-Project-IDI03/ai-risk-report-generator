// One turn from MarshBot (AS-06 canvas C1): its face in the turn's mood beside a stack of speech
// bubbles and cards, "MarshBot" above the first turn of a run. A turn pushed in while the screen
// is open (`fresh`) arrives message by message (the Overview's useReveal.ts, .mbt-in); until its
// first message is out it is `hidden`. Shared by the Overview's thread (SessionTurns.tsx) and the
// knowledge chat's answers (features/chat/components/AnswerTurn.tsx).
import type { ReactNode } from 'react'
import { MarshBotFace, type Mood } from './MarshBotFace'
import './conversation.css'

/** Returns a bot turn: face, optional name, then `children` (TurnBody or the typing dots). */
export function BotTurn({
  id,
  mood,
  named,
  faced = true,
  fresh = false,
  hidden = false,
  children,
}: {
  // The turn's id on the page, so the agenda can jump to it (Agenda.tsx).
  id?: string
  mood: Mood
  named: boolean
  // false = a later turn of the same run: the face's column stays, empty, so bubbles line up.
  faced?: boolean
  fresh?: boolean
  // Kept mounted (so its messages can count themselves) but not drawn.
  hidden?: boolean
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
      hidden={hidden || undefined}
      data-fresh={fresh || undefined}
      data-grouped={!faced || undefined}
      // Named: the face drops by the name's height, level with the first bubble (thread.css).
      data-named={named || undefined}
    >
      <span className="mbt-face mbt-in">{faced && <MarshBotFace mood={mood} decorative />}</span>
      <div className="mbt-stack">
        {named && <span className="mbt-who">MarshBot</span>}
        {children}
      </div>
    </div>
  )
}
