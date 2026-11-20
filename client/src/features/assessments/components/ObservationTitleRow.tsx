// The Observations tab's title row (CP-24, AC16): "All Observations" with the Site walk
// proposals button at the right, always there, with its count of walks ready to review when
// there are any. "Proposals" on a phone. Called by screens/Observations.tsx.
import { Button, CountPill, useIsPhone } from '../../../design-system'

/** Returns the title and the button that opens the Site Walk Proposals list. */
export function ObservationTitleRow({
  ready,
  total,
  onOpen,
}: {
  // Walks that are ready to review: the count shown.
  ready: number
  // Walks listed (any state): names the button when none is ready.
  total: number
  onOpen: () => void
}) {
  const phone = useIsPhone()
  return (
    <div className="cpo-title-row">
      <h2 className="ob-title">{'All Observations'}</h2>
      <Button
        variant="pill"
        iconLeft="list"
        aria-label={
          ready
            ? `Site walk proposals, ${ready} ready to review`
            : total
              ? `Site walk proposals (${total})`
              : 'Site walk proposals'
        }
        style={phone ? { height: 44 } : undefined}
        onClick={onOpen}
      >
        {phone ? 'Proposals' : 'Site walk proposals'}
        {ready > 0 && <CountPill>{ready}</CountPill>}
      </Button>
    </div>
  )
}
