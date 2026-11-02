// The capture screen's location field and picker (CP-16, CP-22), and the Remove
// location dialog. The picker only picks: the Observations sidebar adds, edits
// and removes locations. Called by screens/SiteObservation.tsx; LocationForm is
// re-exported for screens/Observations.tsx.
import { useId, type AriaAttributes } from 'react'
import { Callout, Dialog, Icon, Input, Popover } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { LocationForm } from './LocationForm'
import { LocationPath } from './LocationPath'
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
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={busy}
            onClick={v.closeLocRemove}
          >
            {'Cancel'}
          </button>
          <button
            type="button"
            className="cap-btn cap-btn--danger"
            disabled={busy}
            onClick={() => run(v.confirmLocRemove)}
          >
            {'Remove location'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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

// The Location field of the capture form: where observations are being saved,
// and the way to change it. The dropdown passes it its open state (aria-expanded and the like).
function LocationBar({
  v,
  onClick,
  ...popup
}: { v: AssessmentWorkflow; onClick: () => void } & AriaAttributes) {
  return (
    <button
      type="button"
      className="cap-select"
      onClick={onClick}
      {...popup}
      data-empty={v.locationLabel ? undefined : ''}
      aria-label={
        v.locationLabel ? 'Location: ' + v.locationLabel + '. Change' : 'Choose a location'
      }
    >
      <Icon name="map-pin" size={20} color="var(--marsh-navy)" />
      {v.locationPath ? <LocationPath {...v.locationPath} /> : <span>{'Choose a location'}</span>}
      <Icon
        name={v.locSheetOpen ? 'chevron-up' : 'chevron-down'}
        size={18}
        color="var(--text-secondary)"
      />
    </button>
  )
}

// What the picker says under "Where are you?": a new assessment starts with
// the form to add its first location.
const pickerDescription = (v: AssessmentWorkflow) =>
  v.proposalCapture
    ? 'The site walk’s locations and the assessment’s others.'
    : v.noLocations
      ? 'Add the first location you’re inspecting. Observations are saved to it.'
      : 'Observations are saved to the location you choose.'

// The location bar, and where the engineer picks, searches for, adds or
// changes the location they are capturing in. On a phone it opens a bottom
// sheet. Wider, it drops down from the bar with no backdrop, so the workspace
// header and tabs stay clear and usable (workflow.css sizes it to the bar). It
// opens by itself until a location is chosen, and either can be closed
// without one.
export function LocationPicker({ v }: { v: AssessmentWorkflow }) {
  if (v.phone)
    return (
      <>
        <LocationBar v={v} onClick={v.openLocations} />
        <Dialog
          className="ds-dialog-sheet"
          open={v.locSheetOpen}
          title="Where are you?"
          description={pickerDescription(v)}
          width={440}
          onClose={v.closeLocations}
        >
          <LocationChoices v={v} />
        </Dialog>
      </>
    )
  return (
    <Popover
      open={v.locSheetOpen}
      // Kept open while Remove this location? asks, which sits outside it.
      onOpenChange={(open) => !open && !v.locRemoveLabel && v.closeLocations()}
      trigger={<LocationBar v={v} onClick={v.toggleLocations} />}
      ariaLabel="Where are you?"
      align="left"
      className="capture-location"
      surfaceClassName="capture-location-menu"
      style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex' }}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {'Where are you?'}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{pickerDescription(v)}</div>
        </div>
        <LocationChoices v={v} />
      </div>
    </Popover>
  )
}

// Search, the assessment's locations by building and level (CP-16), and the
// form adding one. Picking only: editing and removing are the sidebar's.
function LocationChoices({ v }: { v: AssessmentWorkflow }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {!v.noLocations && (
        <>
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
        onClick={() => v.chooseLocation(l.id)}
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
