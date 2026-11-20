// Add observation (CP-24, AC16): the Observations tab's one navy button, whose menu offers
// the two ways to add. A sheet on a phone. Called by screens/Observations.tsx, which passes
// the handlers the two old buttons ("Add manually", "Record site walk") called.
import { AddMenuButton, type AddMenuOption } from '../../../design-system'

type Way = 'manual' | 'walk'
const WAYS: AddMenuOption<Way>[] = [
  {
    value: 'manual',
    icon: 'pencil-line',
    label: 'Add observation manually',
    note: 'Choose a location and write down what you saw.',
    tone: 'form',
  },
  {
    value: 'walk',
    icon: 'mic',
    label: 'Record a site walk',
    note: 'Talk through what you see as you walk. Each finding comes back for you to review.',
    tone: 'walk',
  },
]

/** Returns the Add observation button; `onManual` and `onWalk` run for the two menu rows. */
export function AddObservationMenu({
  onManual,
  onWalk,
  fullWidth,
}: {
  onManual: () => void
  onWalk: () => void
  fullWidth?: boolean
}) {
  return (
    <AddMenuButton
      label="Add observation"
      buttonLabel="Add observation"
      options={WAYS}
      fullWidth={fullWidth}
      onChoose={(way) => (way === 'manual' ? onManual() : onWalk())}
    >
      {/* On a toolbar too tight for the words it says "Add" (.cpo-more, observations.css). */}
      {'Add'}
      <span className="cpo-more">{' observation'}</span>
    </AddMenuButton>
  )
}
