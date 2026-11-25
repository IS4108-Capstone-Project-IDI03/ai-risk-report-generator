// The capture screen's location field and picker (CP-16, CP-22), and the Remove
// location dialog. The picker only picks: the Observations sidebar adds, edits
// and removes locations. Called by screens/SiteObservation.tsx; LocationForm is
// re-exported for screens/Observations.tsx.
import { useEffect, useId, useRef } from 'react'
import {
  Button,
  Callout,
  Dialog,
  Icon,
  Input,
  PickerField,
  Popover,
  type PickerListSlot,
} from '../../../design-system'
import { signal } from '../../walkthrough/signals'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureHelp } from './CaptureHelp'
import { LocationForm } from './LocationForm'
import { LocationPath } from './LocationPath'
import { FindMyBlock } from './FindMyBlock'
import { useSave } from './useSave'
import '../capture.css'

export { LocationForm }

// Confirms removing a location added by mistake (CP-15 AC6), in the same
// style as deleting an observation. A location that observations are saved
// in, deleted ones included, is refused, and the dialog says why (AC7).
export function RemoveLocationDialog({ v }: { v: AssessmentWorkflow }) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Remove this location?"
      width={480}
      onClose={busy ? undefined : v.closeLocRemove}
      footer={
        <>
          <Button variant="pill" disabled={busy} onClick={v.closeLocRemove}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" disabled={busy} onClick={() => run(v.confirmLocRemove)}>
            {'Remove location'}
          </Button>
        </>
      }
    >
      <div className="cap-stack">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Location not removed">
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-quote">
          {v.locRemovePath && <LocationPath {...v.locRemovePath} />}
        </p>
        <p className="cap-dialog-text">
          {'It comes off this assessment’s list of locations. You can add it again at any time.'}
        </p>
      </div>
    </Dialog>
  )
}

// What the picker says under "Where are you?", only when it adds something: a new assessment
// starts with the form to add its first location. A plain pick needs no line.
const pickerDescription = (v: AssessmentWorkflow) =>
  v.proposalCapture
    ? 'The site walk’s locations and the assessment’s others.'
    : v.noLocations
      ? 'Add the first location you’re inspecting. Observations are saved to it.'
      : undefined

// The Location field of New Observation (CP-24), and where the engineer picks, searches for, adds
// or changes the location they are capturing in. On a phone the list opens as a bottom sheet.
// Wider, it drops down from the field with no backdrop, so the workspace header and tabs stay
// clear and usable (workflow.css sizes it to the field). It opens by itself until a location is
// chosen, and either can be closed without one. Save with none chosen turns the field red with
// one line under it; pressing Save again shakes it once (v2 Forms).
export function LocationPicker({ v }: { v: AssessmentWorkflow }) {
  const box = useRef<HTMLDivElement>(null)
  // a. Each refused Save goes to the field; a later one, while the line is still there, shakes it.
  useEffect(() => {
    const el = box.current
    if (!el || !v.locationRefused) return
    el.querySelector<HTMLElement>('.cpf-button')?.focus({ preventScroll: true })
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    if (v.locationRefused > 1) {
      // The class is taken off and the layout read, so the animation starts again.
      el.classList.remove('ds-shake')
      void el.offsetWidth
      el.classList.add('ds-shake')
    }
  }, [v.locationRefused])
  const list = ({ className, trigger }: PickerListSlot) =>
    v.phone ? (
      <>
        {trigger(v.locSheetOpen, v.openLocations)}
        <Dialog
          className="ds-dialog-sheet"
          open={v.locSheetOpen}
          title="Where are you?"
          description={pickerDescription(v)}
          width={440}
          onClose={v.closeLocations}
        >
          <LocationChoices v={v} walk="new-observation.location-menu" />
        </Dialog>
      </>
    ) : (
      <Popover
        open={v.locSheetOpen}
        // Kept open while Remove this location? asks, which sits outside it.
        onOpenChange={(open) => !open && !v.locRemoveLabel && v.closeLocations()}
        trigger={trigger(v.locSheetOpen, v.toggleLocations)}
        ariaLabel="Where are you?"
        align="left"
        className={className}
        surfaceClassName="capture-location-menu"
      >
        <div
          data-walk="new-observation.location-menu"
          style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
              {'Where are you?'}
            </div>
            {pickerDescription(v) && (
              <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                {pickerDescription(v)}
              </div>
            )}
          </div>
          <LocationChoices v={v} />
        </div>
      </Popover>
    )
  return (
    <div ref={box} className="cap-loc-field" data-walk="new-observation.location">
      <PickerField
        label="Location"
        required
        placeholder="Choose a location"
        valueLabel={v.locationLabel ?? undefined}
        value={
          v.locationPath ? (
            <>
              <Icon name="map-pin" size={18} color="var(--marsh-navy)" />
              <LocationPath {...v.locationPath} />
            </>
          ) : undefined
        }
        error={v.locationRefused ? 'Choose a location' : undefined}
        help={<CaptureHelp proposal={v.proposalCapture} />}
        list={list}
      />
    </div>
  )
}

// Search, the assessment's locations by building and level (CP-16), and the
// form adding one. Picking only: editing and removing are the sidebar's.
function LocationChoices({ v, walk }: { v: AssessmentWorkflow; walk?: string }) {
  return (
    <div data-walk={walk} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {!v.noLocations && (
        <>
          <FindMyBlock pins={v.locPins} onBlock={v.showBlock} onHere={v.trackedTo} />
          {v.locBlock && (
            <p className="sm-found">
              {'Showing ' + v.locBlock}
              <button type="button" onClick={() => v.showBlock(null)}>
                {'Show all locations'}
              </button>
            </p>
          )}
          <Input
            type="search"
            label="Search locations"
            iconLeft="search"
            value={v.locQuery}
            onChange={v.setLocQuery}
          />
          <div
            role="group"
            aria-label="Locations"
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            {v.locationGroups.map((g) => (
              <LocationGroup key={g.key} v={v} group={g} />
            ))}
          </div>
          {v.locNoMatch && (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
              {'No location matches "' + v.locQuery + '".'}
            </p>
          )}
        </>
      )}
      {/* Last, below the locations that exist. A site walk's capture only picks:
          its review adds locations. */}
      {v.proposalCapture ? null : v.locAdding ? (
        <LocationForm v={v} />
      ) : (
        <button type="button" className="cap-btn cap-btn--secondary" onClick={v.startAddLocation}>
          <Icon name="plus" size={16} />
          {'Add a location'}
        </button>
      )}
    </div>
  )
}

type Group = AssessmentWorkflow['locationGroups'][number]

// One building (or Elsewhere on site): its name and how many locations it
// holds, then each level's locations. It folds away when there are others.
function LocationGroup({ v, group }: { v: AssessmentWorkflow; group: Group }) {
  const id = useId()
  const count = group.count + (group.count === 1 ? ' location' : ' locations')
  const heading = (
    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
      {/* A long building name wraps under itself; the count centres against its lines. */}
      <span
        style={{
          minWidth: 0,
          overflowWrap: 'anywhere',
          // Sentence case, not spaced capitals, so a long building name wraps like text.
          fontSize: '15px',
          lineHeight: 1.3,
          fontWeight: '600',
          color: 'var(--text-primary)',
        }}
      >
        {group.title}
      </span>
      <span style={{ flex: 'none', fontSize: '13px', color: 'var(--text-muted)' }}>{count}</span>
    </span>
  )
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {group.collapsible ? (
        <button
          type="button"
          aria-label={group.title + ', ' + count}
          aria-expanded={group.open}
          aria-controls={id}
          onClick={group.toggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            minHeight: '44px',
            padding: '0 4px',
            textAlign: 'left',
            fontFamily: 'inherit',
            background: 'none',
            border: 0,
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          <span style={{ flex: 'none', display: 'flex' }}>
            <Icon
              name={group.open ? 'chevron-down' : 'chevron-right'}
              size={16}
              color="var(--text-secondary)"
            />
          </span>
          {heading}
        </button>
      ) : (
        <div style={{ display: 'flex', padding: '4px 4px 0' }}>{heading}</div>
      )}
      {group.open && (
        <div id={id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {group.levels.map((level) => (
            <div key={level.title ?? ''}>
              {!!level.title && (
                <div
                  style={{
                    margin: '0 0 6px 4px',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                  }}
                >
                  {level.title}
                </div>
              )}
              <ul
                aria-label={[group.title, level.title].filter(Boolean).join(' · ')}
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {level.locations.map((l) => (
                  <LocationRow key={l.id} v={v} location={l} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

type Row = Group['levels'][number]['locations'][number]

// A location to capture in, named on its own under its building and level.
function LocationRow({ v, location: l }: { v: AssessmentWorkflow; location: Row }) {
  return (
    <li>
      <button
        type="button"
        className="cap-loc"
        aria-pressed={l.selected}
        aria-label={l.label + (l.detail ? ', ' + l.detail : '')}
        onClick={() => {
          v.chooseLocation(l.id)
          // F-12: "Add an observation" step 1 asks for the loading bay, the practice assessment's one.
          if (/loading bay/i.test(l.name)) signal('observation-location-chosen')
        }}
      >
        <Icon name="map-pin" size={18} color="var(--marsh-navy)" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: '15px',
              fontWeight: '500',
              color: 'var(--text-primary)',
              overflowWrap: 'anywhere',
            }}
          >
            {l.name}
          </span>
          {!!l.detail && (
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)' }}>
              {l.detail}
            </span>
          )}
        </span>
        {l.selected && <Icon name="check" size={18} color="var(--marsh-navy)" />}
      </button>
    </li>
  )
}
