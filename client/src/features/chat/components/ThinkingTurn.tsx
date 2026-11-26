// MarshBot typing in the knowledge chat (CB-01): the Overview's typing dots in a MarshBot turn,
// with what it is doing as words. Drawn under a just-sent question (UserMessage.tsx) and by the
// search step (SearchStep.tsx) until the answer starts. The words are repeated for a screen
// reader, since the dots are hidden from it; the caller puts it in a status region.
import { BotTurn, TypingDots } from '../../../design-system'

/** Returns MarshBot's thinking turn; `label` names the step ("Searching the knowledge base…"). */
export function ThinkingTurn({ label }: { label?: string }) {
  return (
    <div className="chat-thinking">
      <BotTurn mood="thinking" named>
        <TypingDots label={label} />
      </BotTurn>
      <span className="ds-sr-only">{label ?? 'MarshBot is writing'}</span>
    </div>
  )
}
