// The engineer's own turn (AS-06 canvas C5, C9): a navy bubble on the right with its tail, the
// reply they pressed. Drawn by SessionTurns.tsx, and by Thread.tsx while a reply is on its way.

/** Returns the engineer's bubble; `sending` marks the one not saved yet. */
export function EngineerBubble({ text, sending = false }: { text: string; sending?: boolean }) {
  return (
    <div className="mbt-me" data-sending={sending || undefined}>
      {/* MarshBot's turns are headed by its name; without this a screen reader hears no speaker. */}
      <span className="mbt-sr">You: </span>
      {text}
    </div>
  )
}
