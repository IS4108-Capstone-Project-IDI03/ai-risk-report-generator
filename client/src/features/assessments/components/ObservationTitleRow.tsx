// The Observations tab's title row (CP-24, AC16): "All Observations" with the Site walk
// proposals button at the right, always there, with its count of walks ready to review when
// there are any. "Proposals" on a phone. Beside the title, the List / Buildings switch (CP-61).
// Called by screens/Observations.tsx.
import { Button, CountPill, SegmentedControl, useIsPhone } from '../../../design-system'

export type ObservationsLayout = 'list' | 'stack'

/** Returns the title, the view switch and the button that opens the Site Walk Proposals list. */
export function ObservationTitleRow({
  ready,
  total,
  onOpen,
  view,
  onView,
}: {
  // Walks that are ready to review: the count shown.
  ready: number
  // Walks listed (any state): names the button when none is ready.
  total: number
  onOpen: () => void
  // The list, or the building stack (CP-61).
  view: ObservationsLayout
  onView: (view: ObservationsLayout) => void
}) {
  const phone = useIsPhone()
  return (
    <div className="cpo-title-row">
      <h2 className="ob-title">{'All Observations'}</h2>
      <span className="cpo-view">
        <SegmentedControl
          ariaLabel="View"
          options={[
            { value: 'list', label: 'List', icon: 'rows-3' },
            { value: 'stack', label: 'Buildings', icon: 'building-2' },
          ]}
          value={view}
          onChange={onView}
        />
      </span>
      {/* Light ink blue, not the filter pills' grey: grey was lost against the grey page (CP-24). */}
      <Button
        variant="pill-ink"
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
