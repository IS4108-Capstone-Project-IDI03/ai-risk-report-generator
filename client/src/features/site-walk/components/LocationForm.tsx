// Adds or renames a location in a site walk proposal (CP-22 AC9, round 1): the
// Observations tab's Add location form (assessments/components/LocationForm.tsx)
// in a dialog. In a building (building, optional level, name) or elsewhere on
// site (name only), with the rules in proposal.ts. Used by screens/Review.tsx.
import { useState, type FormEvent } from 'react'
import { Dialog } from '../../../design-system'
import { SuggestField } from '../../assessments/components/SuggestField'
import {
  LEVEL_SUGGESTIONS,
  LOCATION_NAMES,
  suggestions,
  type Place,
} from '../../assessments/locations'
import type { LocationInput } from '../proposal'
import '../../assessments/capture.css'

const KINDS = [
  { kind: 'building', label: 'In a building' },
  { kind: 'elsewhere', label: 'Elsewhere on site' },
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
    >
      <form className="cap-form" onSubmit={submit} aria-label={title}>
        <fieldset style={{ margin: 0, padding: 0, border: 'none', minWidth: 0 }}>
          <legend className="cap-label" style={{ padding: 0, marginBottom: '6px' }}>
            Where is it?
          </legend>
          <div className="cap-kinds">
            {KINDS.map(({ kind, label }) => (
              <label key={kind} className="ds-choice cap-kind">
                <input
                  type="radio"
                  name="location-kind"
                  checked={input.kind === kind}
                  onChange={() => set({ kind })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {inBuilding && (
          <div className="cap-form-row">
            <SuggestField
              label="Building"
              required
              size="lg"
              placeholder="e.g. Block A"
              maxLength={100}
              suggestions={suggestions(known.map((l) => l.building))}
              value={input.building}
              onChange={(e) => set({ building: e.target.value })}
            />
            <SuggestField
              label="Level"
              size="lg"
              placeholder="e.g. Level 2"
              maxLength={40}
              suggestions={suggestions(
                known.map((l) => l.floor),
                LEVEL_SUGGESTIONS,
              )}
              value={input.floor}
              onChange={(e) => set({ floor: e.target.value })}
            />
          </div>
        )}
        {inBuilding && (
          <p className="cap-hint" style={{ marginTop: '-8px' }}>
            Leave the level blank if the location is the whole building, such as its roof.
          </p>
        )}
        <SuggestField
          label="Location"
          required
          size="lg"
          placeholder={
            inBuilding ? 'e.g. Staircase, Store room, Lobby' : 'e.g. Fire access route, Guardhouse'
          }
          maxLength={100}
          suggestions={suggestions(
            known.map((l) => l.name),
            LOCATION_NAMES,
          )}
          value={input.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        {problem && (
          <p className="swr-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="cap-form-actions">
          <button type="button" className="cap-btn cap-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cap-btn cap-btn--primary">
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
