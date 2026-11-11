// The engineer's own answer to MarshBot (AS-06 board 05): a navy bubble on the right, "You · when"
// under it. A pressed quick reply rises 8 px into place (board 12). Called by
// screens/MarshBotOverview.tsx for thread entries and the reply on its way.

/** Returns the engineer's own answer: a navy bubble on the right and "You · when" under it. */
export function EngineerReply({ text, said }: { text: string; said: string }) {
  return (
    <div className="mb-me-wrap">
      <div className="mb-me">{text}</div>
      <div className="mb-me-when">{`You · ${said}`}</div>
    </div>
  )
}
