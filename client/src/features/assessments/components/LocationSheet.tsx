import { useEffect, useId, useRef, type AriaAttributes, type CSSProperties } from 'react'
import { Button, Callout, Dialog, Icon, IconButton, Input, Popover } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useSave } from './useSave'

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
          <Button variant="secondary" disabled={busy} onClick={v.closeLocRemove}>
            {'Cancel'}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => run(v.confirmLocRemove)}>
            {'Remove location'}
          </Button>
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
        <p
          style={{
            margin: 0,
            paddingLeft: '12px',
            borderLeft: '2px solid var(--border-strong)',
            fontSize: '15px',
            lineHeight: '24px',
            color: 'var(--text-body)',
          }}
        >
          {v.locRemoveLabel}
        </p>
        <p style={{ margin: 0 }}>
          It comes off this assessment’s list of locations. You can add it again at any time.
        </p>
      </div>
    </Dialog>
  )
}

// The sticky bar at the top of the capture form: where observations are being
// saved, and the way to change it.
// The dropdown passes it its open state (aria-expanded and the like).
function LocationBar({
  v,
  onClick,
  ...popup
}: { v: AssessmentWorkflow; onClick: () => void } & AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...popup}
      aria-label={
        v.locationLabel ? 'Location: ' + v.locationLabel + '. Change' : 'Choose a location'
      }
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        minHeight: '56px',
        padding: '8px 20px',
        textAlign: 'left',
        fontFamily: 'inherit',
        background: v.locationLabel ? 'var(--surface-card)' : 'var(--surface-selected)',
        border: 0,
        borderBottom: '1px solid var(--border-default)',
        // The form card's top corners, as the card no longer clips.
        borderRadius: '8px 8px 0 0',
        cursor: 'pointer',
      }}
    >
      <Icon name="map-pin" size={20} color="var(--action-primary)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {v.locationLabel ?? 'Choose a location'}
        </span>
        <span style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)' }}>
          {v.locationLabel ? 'Tap to change' : 'Observations are saved to it'}
        </span>
      </span>
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
  v.noLocations
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
// form adding one or changing one.
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
      {/* A location being changed is changed in its row, unless a search or a
          folded group hides it. */}
      {v.locAdding && !editingInList(v) ? (
        <LocationForm v={v} />
      ) : (
        <Button variant="secondary" iconLeft="plus" onClick={v.startAddLocation}>
          {'Add a location'}
        </Button>
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
    <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flex: 1, minWidth: 0 }}>
      <span
        style={{
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        {group.title}
      </span>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{count}</span>
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
          <Icon
            name={group.open ? 'chevron-down' : 'chevron-right'}
            size={16}
            color="var(--text-secondary)"
          />
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

// A location to capture in, named on its own under its building and level,
// with Edit for the assigned engineer and Remove while nothing is saved there.
// Whether the location being changed is listed, so its form takes its row.
const editingInList = (v: AssessmentWorkflow) =>
  v.locationGroups.some(
    (g) => g.open && g.levels.some((level) => level.locations.some((l) => l.id === v.locEditId)),
  )

function LocationRow({ v, location: l }: { v: AssessmentWorkflow; location: Row }) {
  // Changed in place, where its pencil was.
  if (l.id === v.locEditId)
    return (
      <li>
        <LocationForm v={v} />
      </li>
    )
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <button
        type="button"
        aria-pressed={l.selected}
        aria-label={l.label + (l.detail ? ', ' + l.detail : '')}
        onClick={() => v.chooseLocation(l.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flex: 1,
          minWidth: 0,
          minHeight: '52px',
          padding: '8px 12px',
          textAlign: 'left',
          fontFamily: 'inherit',
          background: l.selected ? 'var(--surface-selected)' : 'var(--surface-card)',
          border: '1px solid ' + (l.selected ? 'var(--action-primary)' : 'var(--border-default)'),
          borderRadius: '8px',
          cursor: 'pointer',
        }}
      >
        <Icon name="map-pin" size={18} color="var(--action-primary)" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: '15px',
              fontWeight: '500',
              color: 'var(--text-primary)',
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
        {l.selected && <Icon name="check" size={18} color="var(--action-primary)" />}
      </button>
      {!!l.edit && (
        <IconButton icon="pencil" label={'Edit ' + l.label} size="lg" onClick={l.edit} />
      )}
      {!!l.remove && (
        <IconButton icon="trash-2" label={'Remove ' + l.label} size="lg" onClick={l.remove} />
      )}
    </li>
  )
}

// A choice between in a building and elsewhere on site: a native radio drawn
// as a chip, at least 44px tall, as severity is chosen.
function kindChip(on: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '44px',
    padding: '0 8px',
    textAlign: 'center',
    borderRadius: '5px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    border: '1px solid ' + (on ? 'var(--action-primary)' : 'var(--border-default)'),
    background: on ? 'var(--surface-selected)' : 'var(--surface-card)',
    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
  }
}

// Asks about a building, level or location name new to the site that looks
// mistyped (CP-16), under its field: use the name it was probably meant to
// be, or keep it as typed; either carries on saving. A level with no likely
// name can be kept, e.g. the site's Podium, or changed.
function NameCheckCallout({ v }: { v: AssessmentWorkflow }) {
  const check = v.lfCheck!
  const quoted = '\u201c' + check.typed + '\u201d'
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
              <Button
                size="sm"
                variant="primary"
                disabled={v.lfBusy}
                onClick={v.acceptCheckedSuggestion}
              >
                {'Use ' + check.suggestion}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={v.changeCheckedName}>
                {'Change it'}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={v.lfBusy} onClick={v.keepCheckedName}>
              {'Keep ' + quoted}
            </Button>
          </div>
        }
      >
        {check.field !== 'floor'
          ? 'Check the spelling of ' + quoted + '.'
          : check.suggestion
            ? quoted + ' isn\u2019t a level name we recognise.'
            : quoted + ' isn\u2019t a standard level name. Keep it if the site calls it that.'}
      </Callout>
    </div>
  )
}

// Adds a location, or changes the one being edited (CP-16): in a building,
// with an optional level (none for the whole building), or elsewhere on site,
// with a name only. Building and Level suggest the names already used.
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
      aria-label={v.locEditing ? 'Edit location' : 'Add a location'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
      }}
    >
      <fieldset style={{ margin: 0, padding: 0, border: 'none', minWidth: 0 }}>
        <legend
          style={{
            padding: 0,
            marginBottom: '6px',
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--text-body)',
          }}
        >
          {'Where is it?'}
        </legend>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}
        >
          {kinds.map(({ kind, label }) => (
            <label key={kind} className="ds-choice" style={kindChip(v.lf.kind === kind)}>
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
          <Input
            label="Building"
            required
            placeholder="e.g. Block A"
            maxLength={100}
            list={id + '-buildings'}
            value={v.lf.building}
            onChange={v.setLf('building')}
            error={v.lfErrors.building}
          />
          <datalist id={id + '-buildings'}>
            {v.buildingSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {v.lfCheck?.field === 'building' && <NameCheckCallout v={v} />}
          <Input
            label="Level"
            hint="Leave it blank for the whole building, e.g. its facade or roof."
            placeholder="e.g. Level 2"
            maxLength={40}
            list={id + '-levels'}
            value={v.lf.floor}
            onChange={v.setLf('floor')}
            error={v.lfErrors.floor}
          />
          <datalist id={id + '-levels'}>
            {v.levelSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {v.lfCheck?.field === 'floor' && <NameCheckCallout v={v} />}
        </>
      )}
      <Input
        label="Location"
        required
        placeholder={
          inBuilding ? 'e.g. Staircase, Store room, Lobby' : 'e.g. Fire access route, Guardhouse'
        }
        maxLength={100}
        list={id + '-names'}
        value={v.lf.name}
        onChange={v.setLf('name')}
        error={v.lfErrors.name}
      />
      <datalist id={id + '-names'}>
        {v.locationNameSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {v.lfCheck?.field === 'name' && <NameCheckCallout v={v} />}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {!v.noLocations && (
          <Button variant="secondary" disabled={v.lfBusy} onClick={v.cancelLocationForm}>
            {'Cancel'}
          </Button>
        )}
        <Button
          variant="primary"
          iconLeft={v.locEditing ? 'check' : 'plus'}
          loading={v.lfBusy}
          onClick={v.submitLocation}
          style={{ flex: 1 }}
        >
          {v.locEditing ? 'Save location' : 'Add location'}
        </Button>
      </div>
    </section>
  )
}
