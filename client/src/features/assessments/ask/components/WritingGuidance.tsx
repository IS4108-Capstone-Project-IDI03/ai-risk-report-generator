// Writing guidance in the Ask tab (AS-08): two questions about the part of the report open, asked
// by button, never guessed from what is typed. Greyed out with a reason box where they don't apply
// (guidance.ts) or while an answer is written. Drawn above the question box.
import { Button, type Reason } from '../../../../design-system'
import type { GuideKind } from '../api'

/** Returns the "Writing guidance" row with its two buttons. */
export function WritingGuidance({
  label,
  disabled,
  reason,
  onAsk,
}: {
  // The part open, as the report heads it; undefined when none is.
  label?: string
  disabled: boolean
  reason: (kind: GuideKind) => Reason | undefined
  onAsk: (kind: GuideKind) => void
}) {
  return (
    <div className="ask-guide" role="group" aria-label="Writing guidance">
      <p className="ask-guide-for">
        <span className="rv-label">Writing guidance</span>
        <span className="ask-guide-section">{label ?? 'No section open'}</span>
      </p>
      <div className="ask-guide-buttons">
        <Button
          pill
          variant="secondary"
          size="sm"
          iconLeft="list-checks"
          disabled={disabled}
          disabledReason={reason('cover')}
          onClick={() => onAsk('cover')}
        >
          What should this section cover?
        </Button>
        <Button
          pill
          variant="secondary"
          size="sm"
          iconLeft="list-x"
          disabled={disabled}
          disabledReason={reason('missing')}
          onClick={() => onAsk('missing')}
        >
          What is missing from this section?
        </Button>
      </div>
    </div>
  )
}
