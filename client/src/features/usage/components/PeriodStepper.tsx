// Steps a calendar month or year back and forward (EV-04): ‹ October 2026 ›, the shared
// PeriodStepper with a way back to now.
// Forward stops at the current period, and "This month" (or "This year")
// returns to it from an earlier one. The period shown is a live region, so a
// screen reader hears it change. Used by screens/ChatUsageDetail.tsx.
import { Button, PeriodStepper as Stepper } from '../../../design-system'

export function PeriodStepper({
  unit,
  label,
  isCurrent,
  onPrevious,
  onNext,
  onCurrent,
}: {
  unit: 'month' | 'year'
  // The period shown, e.g. "October 2026".
  label: string
  // Showing the current month or year: there is nothing later to step to.
  isCurrent: boolean
  onPrevious: () => void
  onNext: () => void
  onCurrent: () => void
}) {
  return (
    <div className="uc-stepper">
      <Stepper
        label={label}
        unit={unit}
        onPrevious={onPrevious}
        onNext={onNext}
        atLatest={isCurrent}
      />
      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={onCurrent}>
          {`This ${unit}`}
        </Button>
      )}
    </div>
  )
}
