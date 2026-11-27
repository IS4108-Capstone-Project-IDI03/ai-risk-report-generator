// MarshBot at work on an Ask turn (AS-01, AS-04, AS-08): the shared typing dots naming the step
// ("Searching the observations…", "Writing the answer…"). The dots are hidden from screen readers,
// so the step is also said once in a hidden status line. Drawn by the Ask tab's turns.
import { TypingDots } from '../../../../design-system'

/** Returns the typing dots with the step's name, announced politely. */
export function TurnTyping({ label }: { label?: string }) {
  return (
    <>
      <TypingDots label={label} />
      {label && (
        <p className="ask-sr-only" role="status">
          {label}
        </p>
      )}
    </>
  )
}
