// Adds or renames a location in a site walk proposal (CP-22 AC9, round 1): the
// Observations tab's Add location form (assessments/components/LocationForm.tsx)
// in a dialog. In a building (building, optional level, name) or elsewhere on
// site (name only), with the rules in proposal.ts. Used by screens/Review.tsx.
import { useId, useState, type FormEvent } from 'react'
import { Button, Combobox, Dialog, SegmentedControl } from '../../../design-system'
import {
  LEVEL_SUGGESTIONS,
  LOCATION_NAMES,
  suggestions,
  type Place,
} from '../../assessments/locations'
import type { LocationInput } from '../proposal'
import { DialogProblem } from './DialogProblem'

const KINDS = [
  { value: 'building', label: 'In a building' },
  { value: 'elsewhere', label: 'Elsewhere on site' },
] as const

// Adds or renames a proposed location through the shared place fields.
export function LocationForm({
  title,
  initial,
  action,
  known,
  phone,
  check,
  onSave,
  onClose,
}: {
  title: string
  initial?: LocationInput
  action: string
  // The locations already known, whose names the fields suggest.
  known: Place[]
  phone: boolean
  // Why the location can't be saved, or null (proposal.ts locationProblem).
  check: (input: LocationInput) => string | null
  onSave: (input: LocationInput) => void
  onClose: () => void
}) {
  const [input, setInput] = useState<LocationInput>(
    initial ?? { kind: 'building', building: '', floor: '', name: '' },
  )
  const [problem, setProblem] = useState<string | null>(null)
  // The footer's button is outside the form, so it names the form it submits.
  const form = useId()
  const set = (patch: Partial<LocationInput>) => {
    setInput((i) => ({ ...i, ...patch }))
    setProblem(null)
  }
  const inBuilding = input.kind === 'building'

  function submit(e: FormEvent) {
    e.preventDefault()
    const refused = check(input)
    if (refused) setProblem(refused)
    else onSave(input)
  }

  return (
    <Dialog
      className={phone ? 'ds-dialog-sheet' : undefined}
      title={title}
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button pill variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button pill variant="primary" type="submit" form={form}>
            {action}
          </Button>
        </>
      }
    >
      <form id={form} className="swd-form" onSubmit={submit} aria-label={title}>
        <DialogProblem title="Location not saved" problem={problem} />
        <SegmentedControl
          ariaLabel="Where is it?"
          options={[...KINDS]}
          value={input.kind}
          onChange={(kind) => set({ kind })}
        />
        {inBuilding && (
          <div className="swd-form-row">
            <Combobox
              label="Building"
              required
              size="lg"
              placeholder="e.g. Block A"
              maxLength={100}
              options={suggestions(known.map((l) => l.building))}
              value={input.building}
              onValueChange={(value) => set({ building: value })}
            />
            <Combobox
              label="Level"
              hint="Leave blank for the whole building."
              size="lg"
              placeholder="e.g. Level 2"
              maxLength={40}
              options={suggestions(
                known.map((l) => l.floor),
                LEVEL_SUGGESTIONS,
              )}
              value={input.floor}
              onValueChange={(value) => set({ floor: value })}
            />
          </div>
        )}
        <Combobox
          label="Location"
          required
          size="lg"
          placeholder={
            inBuilding ? 'e.g. Staircase, Store room, Lobby' : 'e.g. Fire access route, Guardhouse'
          }
          maxLength={100}
          options={suggestions(
            known.map((l) => l.name),
            LOCATION_NAMES,
          )}
          value={input.name}
          onValueChange={(value) => set({ name: value })}
        />
      </form>
    </Dialog>
  )
}
