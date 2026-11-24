// The engineer's own turn (AS-06 canvas C5, C9): a navy bubble on the right with its tail, the
// reply they pressed. Drawn by SessionTurns.tsx, and by Thread.tsx while a reply is on its way.

/** Returns the engineer's bubble; `sending` marks the one not saved yet; `walk` is its walkthrough tag (F-12). */
export function EngineerBubble({
  text,
  sending = false,
  walk,
}: {
  text: string
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
