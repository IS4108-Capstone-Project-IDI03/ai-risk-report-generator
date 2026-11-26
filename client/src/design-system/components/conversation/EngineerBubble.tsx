// The engineer's own turn (AS-06 canvas C5, C9): a navy bubble on the right with its tail, the
// reply they pressed or the question they typed. Shared by the Overview's thread (SessionTurns.tsx,
// Thread.tsx) and the knowledge chat (features/chat/components/UserMessage.tsx).
import type { ReactNode } from 'react'
import './conversation.css'

/** Returns the engineer's bubble; `sending` marks the one not saved yet; `walk` is its walkthrough tag (F-12). */
export function EngineerBubble({
  text,
  sending = false,
  walk,
}: {
  text: ReactNode
  sending?: boolean
  walk?: string
}) {
  return (
    <div className="mbt-me" data-sending={sending || undefined} data-walk={walk}>
      {/* MarshBot's turns are headed by its name; without this a screen reader hears no speaker. */}
      <span className="mbt-sr">You: </span>
      {text}
    </div>
  )
}
