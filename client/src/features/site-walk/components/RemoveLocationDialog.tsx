// Confirms deleting a new location from the proposal (CP-22 round 1): its
// observations stay, and move to "No location yet". Used by screens/Review.tsx.
import { Dialog } from '../../../design-system'

// Confirms a location removal and explains where its observations go.
export function RemoveLocationDialog({
  name,
  count,
  onConfirm,
  onClose,
}: {
  name: string
  // How many observations are at it.
  count: number
  onConfirm: () => void
  onClose: () => void
}) {
  const moved =
    count === 0
      ? 'It has no observations.'
      : `Its ${count === 1 ? 'observation moves' : `${count} observations move`} to “No location yet”, where you can choose a place for ${count === 1 ? 'it' : 'them'}.`
  return (
    <Dialog
      title="Delete this location?"
      description={`“${name}” is only in this proposal, so nothing on the assessment changes. ${moved}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cap-btn cap-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cap-btn cap-btn--danger" onClick={onConfirm}>
            Delete location
          </button>
        </>
      }
    />
  )
}
