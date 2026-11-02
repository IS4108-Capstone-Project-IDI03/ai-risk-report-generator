// The Add location form (CP-16, CP-22): a calm form with building and level
// side by side (one column on a phone), a location name, and Add location as
// the one navy button, bottom right. Also changes a location (the sidebar's
// pencil). Used by LocationSheet.tsx's picker and screens/Observations.tsx's dialog.
import { useEffect, useId, useRef } from 'react'
import { Callout } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { SuggestField } from './SuggestField'
import '../capture.css'

// Asks about a building, level or location name new to the site that looks
// mistyped (CP-16), under its field: use the name it was probably meant to
// be, or keep it as typed; either carries on saving. A level with no likely
// name can be kept, e.g. the site's Podium, or changed.
function NameCheckCallout({ v }: { v: AssessmentWorkflow }) {
  const check = v.lfCheck!
  const quoted = '“' + check.typed + '”'
  return (
    <div role="alert">
      <Callout
        tone="warning"
        title={
          check.suggestion
            ? 'Did you mean ' + check.suggestion + '?'
            : 'Check the ' + (check.field === 'building' ? 'building' : 'level')
        }
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {check.suggestion ? (
              <button
                type="button"
                className="cap-btn cap-btn--primary"
                disabled={v.lfBusy}
                onClick={v.acceptCheckedSuggestion}
              >
                {'Use ' + check.suggestion}
              </button>
            ) : (
              <button
                type="button"
                className="cap-btn cap-btn--secondary"
                onClick={v.changeCheckedName}
              >
                {'Change it'}
              </button>
            )}
            <button
              type="button"
              className="cap-btn cap-btn--secondary"
              disabled={v.lfBusy}
              onClick={v.keepCheckedName}
            >
              {'Keep ' + quoted}
            </button>
          </div>
        }
      >
        {check.field !== 'floor'
          ? 'Check the spelling of ' + quoted + '.'
          : check.suggestion
            ? quoted + ' isn’t a level name we recognise.'
            : quoted + ' isn’t a standard level name. Keep it if the site calls it that.'}
      </Callout>
    </div>
  )
}

// Adds a location, or changes the one being edited: in a building, with an
// optional level (none for the whole building), or elsewhere on site, with a
// name only. Building and Level suggest the names already used, in our own
// list (SuggestField.tsx), not the browser's.
export function LocationForm({ v }: { v: AssessmentWorkflow }) {
  const id = useId()
  const inBuilding = v.lf.kind === 'building'
  // Opened from a pencil or Add a location, it comes into view with the
  // cursor in its first box, as the button pressed is gone. A new
  // assessment's picker opens on it, so the keyboard waits for a tap there.
  const form = useRef<HTMLElement>(null)
  const opened = !v.noLocations
  useEffect(() => {
    if (!opened) return
    form.current?.scrollIntoView?.({ block: 'nearest' })
    form.current?.querySelector<HTMLInputElement>('input:not([type=radio])')?.focus()
  }, [opened])
  const kinds = [
    { kind: 'building', label: 'In a building' },
    { kind: 'elsewhere', label: 'Elsewhere on site' },
  ] as const
  return (
    <section
      ref={form}
      className="cap-form"
      aria-label={v.locEditing ? 'Edit location' : 'Add a location'}
    >
      <fieldset style={{ margin: 0, padding: 0, border: 'none', minWidth: 0 }}>
        <legend className="cap-label" style={{ padding: 0, marginBottom: '6px' }}>
          {'Where is it?'}
        </legend>
        <div className="cap-kinds">
          {kinds.map(({ kind, label }) => (
            <label key={kind} className="ds-choice cap-kind">
              <input
                type="radio"
                name={id + '-kind'}
                value={kind}
                checked={v.lf.kind === kind}
                onChange={() => v.setLfKind(kind)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {inBuilding && (
        <>
          <div className="cap-form-row">
            <SuggestField
              label="Building"
              required
              size="lg"
              placeholder="e.g. Block A"
              maxLength={100}
              suggestions={v.buildingSuggestions}
              value={v.lf.building}
              onChange={v.setLf('building')}
              error={v.lfErrors.building}
            />
            <SuggestField
              label="Level"
              size="lg"
              placeholder="e.g. Level 2"
              maxLength={40}
              suggestions={v.levelSuggestions}
              value={v.lf.floor}
              onChange={v.setLf('floor')}
              error={v.lfErrors.floor}
            />
          </div>
          <p className="cap-hint" style={{ marginTop: '-8px' }}>
            {'Leave the level blank if the location is the whole building, such as its roof.'}
          </p>
          {v.lfCheck?.field === 'building' && <NameCheckCallout v={v} />}
          {v.lfCheck?.field === 'floor' && <NameCheckCallout v={v} />}
        </>
      )}
      <SuggestField
        label="Location"
        required
        size="lg"
        placeholder={
          inBuilding ? 'e.g. Staircase, Store room, Lobby' : 'e.g. Fire access route, Guardhouse'
        }
        maxLength={100}
        suggestions={v.locationNameSuggestions}
        value={v.lf.name}
        onChange={v.setLf('name')}
        error={v.lfErrors.name}
      />
      {v.lfCheck?.field === 'name' && <NameCheckCallout v={v} />}
      <div className="cap-form-actions">
        {!v.noLocations && (
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={v.lfBusy}
            onClick={v.cancelLocationForm}
          >
            {'Cancel'}
          </button>
        )}
        <button
          type="button"
          className="cap-btn cap-btn--primary"
          disabled={v.lfBusy}
          aria-busy={v.lfBusy}
          onClick={v.submitLocation}
        >
          {v.locEditing ? 'Save location' : 'Add location'}
        </button>
      </div>
    </section>
  )
}
