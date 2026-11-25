// Failed line with a pill (CP-24, v2 NEW pattern): the short red error with its alert icon and a
// labelled "Try again" pill, on one line. Fades in and slides down 3 px (the v2 failed-file
// motion). 44 px tall on touch screens (cp24.css). Called by the observation page under its
// fields. Calls Icon, Button.
import { Button } from '../core/Button'
import { Icon } from '../core/Icon'

export type FailedLineProps = {
  // The short error, e.g. "Suggestion failed".
  message: string
  actionLabel?: string
  // Without it (a view-only user) the line only says what failed.
  onAction?: () => void
  // The retry is on its way: the pill waits.
  busy?: boolean
}

/** Returns the line: red icon, the error in 600, and the Try again pill at the right. */
export function FailedLine({
  message,
  actionLabel = 'Try again',
  onAction,
  busy,
}: FailedLineProps) {
  return (
    <div className="ds-failed-line" role="alert">
      <Icon name="circle-alert" size={16} color="var(--red-600)" />
      <strong>{message}</strong>
      {onAction && (
        <Button variant="pill" size="sm" iconLeft="rotate-ccw" loading={busy} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
