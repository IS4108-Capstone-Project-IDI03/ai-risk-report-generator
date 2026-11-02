// "Use an existing location" (CP-22 AC9, round 1): the assessment's own
// locations, each as an arrow path. Choosing one moves all of the new
// location's observations to it and drops the new one (proposal.ts sameAs).
// Used by screens/Review.tsx.
import { Dialog } from '../../../design-system'
import type { SiteLocation } from '../../assessments/api'
import { LocationPath } from '../../assessments/components/LocationPath'
import { groupLocations } from '../../assessments/locations'
import { pathOf } from '../options'

// Chooses an assessment location to replace a proposed one.
export function ExistingLocationDialog({
  name,
  existing,
  phone,
  onPick,
  onClose,
}: {
  // The new location being replaced, for the heading.
  name: string
  existing: SiteLocation[]
  phone: boolean
  onPick: (existing: SiteLocation) => void
  onClose: () => void
}) {
  const ordered = groupLocations(existing).flatMap((g) =>
    g.levels.flatMap((level) => level.locations),
  )
  return (
    <Dialog
      className={phone ? 'ds-dialog-sheet' : undefined}
      title="Use an existing location"
      description={`Pick the assessment location that “${name}” really is. Its observations move there.`}
      width={480}
      onClose={onClose}
    >
      {ordered.length ? (
        <ul className="swr-existing">
          {ordered.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => onPick(l)}>
                <LocationPath {...pathOf(l)} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="swr-note">The assessment has no locations yet.</p>
      )}
    </Dialog>
  )
}
