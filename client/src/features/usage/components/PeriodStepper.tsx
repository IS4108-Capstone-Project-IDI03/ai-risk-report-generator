// Steps a calendar month or year back and forward (EV-04): ‹ October 2026 ›.
// Forward stops at the current period, and "This month" (or "This year")
// returns to it from an earlier one. The period shown is a live region, so a
// screen reader hears it change. Used by screens/ChatUsageDetail.tsx.
import { Button, IconButton } from '../../../design-system'

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
      <IconButton icon="chevron-left" label={`Previous ${unit}`} size="sm" onClick={onPrevious} />
      <span className="uc-stepper-label" role="status" aria-label="Period shown">
        {label}
      </span>
      <IconButton
        icon="chevron-right"
        label={`Next ${unit}`}
        size="sm"
        disabled={isCurrent}
        onClick={onNext}
      />
      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={onCurrent}>
          {`This ${unit}`}
        </Button>
      )}
    </div>
  )
}
