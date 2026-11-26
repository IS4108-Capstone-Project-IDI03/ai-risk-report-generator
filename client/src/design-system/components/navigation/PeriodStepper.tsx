// Period stepper (CP-60, EV-04; v2 "Calendar grid"): a round shaded chevron each side of the period
// shown ("November 2026", 16 / 700 navy), as wide as its longest period so the arrows don't move.
// The same piece as RecordStepper, for a period. The period is a live region ("Period shown"),
// so a screen reader hears it change. `children` replaces what is seen in the middle (the
// Calendar's month and year buttons) while the period is still read out.
// Called by the Calendar and Usage and costs' chat detail. Calls IconAction.
import type { ReactNode } from 'react'
import { IconAction } from '../core/IconAction'
import './period-stepper.css'

export type PeriodStepperProps = {
  // The period shown, e.g. "October 2026".
  label: string
  // What one step moves by, for the buttons' names ("Previous month").
  unit: string
  onPrevious: () => void
  onNext: () => void
  // Greys out Next: the latest period is showing.
  atLatest?: boolean
  children?: ReactNode
  className?: string
}

/** Returns the stepper: previous, the period, next. */
export function PeriodStepper({
  label,
  unit,
  onPrevious,
  onNext,
  atLatest = false,
  children,
  className,
}: PeriodStepperProps) {
  return (
    <div className={className ? `ds-period ${className}` : 'ds-period'}>
      <IconAction
        icon="chevron-left"
        label={`Previous ${unit}`}
        size="md"
        shaded
        onClick={onPrevious}
      />
      <div className="ds-period-middle">
        {children}
        <strong
          className={children ? 'ds-sr-only' : 'ds-period-label'}
          role="status"
          aria-label="Period shown"
        >
          {label}
        </strong>
      </div>
      <IconAction
        icon="chevron-right"
        label={`Next ${unit}`}
        size="md"
        shaded
        disabled={atLatest}
        onClick={onNext}
      />
    </div>
  )
}
