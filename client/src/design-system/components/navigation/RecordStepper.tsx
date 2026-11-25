// Record stepper (CP-24, v2 NEW pattern): previous / "9 of 27" / next, built as the Calendar's
// period stepper is: a round shaded chevron each side of words in the app font with tabular
// numbers. A chevron greys out at either end. Called by the observation page's header actions.
// Calls IconAction.
import { IconAction } from '../core/IconAction'

export type RecordStepperProps = {
  // The record's place, counting from 1.
  at: number
  total: number
  onPrevious: () => void
  onNext: () => void
  // Names what is stepped through, e.g. "observation".
  noun?: string
}

/** Returns the stepper for "<at> of <total>". */
export function RecordStepper({
  at,
  total,
  onPrevious,
  onNext,
  noun = 'observation',
}: RecordStepperProps) {
  return (
    <nav className="rs" aria-label={noun[0].toUpperCase() + noun.slice(1) + 's'}>
      <IconAction
        icon="chevron-left"
        label={'Previous ' + noun}
        size="md"
        shaded
        disabled={at <= 1}
        onClick={onPrevious}
      />
      <span className="rs-place">
        <b>{at}</b> of <b>{total}</b>
      </span>
      <IconAction
        icon="chevron-right"
        label={'Next ' + noun}
        size="md"
        shaded
        disabled={at >= total}
        onClick={onNext}
      />
    </nav>
  )
}
