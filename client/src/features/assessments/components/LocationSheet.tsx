import type { AriaAttributes } from 'react'
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

// The location bar, and where the engineer picks, searches for or adds the
// location they are capturing in. On a phone it opens a bottom sheet. Wider,
// it drops down from the bar with no backdrop, so the workspace header and
// tabs stay clear and usable (workflow.css sizes it to the bar). It opens by
// itself until a location is chosen, and either can be closed without one.
export function LocationPicker({ v }: { v: AssessmentWorkflow }) {
  if (v.phone)
    return (
      <>
        <LocationBar v={v} onClick={v.openLocations} />
        <Dialog
          className="ds-dialog-sheet"
          open={v.locSheetOpen}
          title="Where are you?"
          description="Observations are saved to the location you choose."
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
          <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
            {'Observations are saved to the location you choose.'}
          </div>
        </div>
        <LocationChoices v={v} />
      </div>
    </Popover>
  )
}

// Search, the assessment's locations, and adding one.
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
          <ul
            aria-label="Locations"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {v.locations.map((l) => (
              <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  aria-pressed={l.selected}
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
                    border:
                      '1px solid ' +
                      (l.selected ? 'var(--action-primary)' : 'var(--border-default)'),
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
                      {l.label}
                    </span>
                    {!!l.detail && (
                      <span
                        style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)' }}
                      >
                        {l.detail}
                      </span>
                    )}
                  </span>
                  {l.selected && <Icon name="check" size={18} color="var(--action-primary)" />}
                </button>
                {!!l.remove && (
                  <IconButton
                    icon="trash-2"
                    label={'Remove ' + l.label}
                    size="lg"
                    onClick={l.remove}
                  />
                )}
              </li>
            ))}
          </ul>
          {v.locations.length === 0 && (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
              {'No location matches "' + v.locQuery + '".'}
            </p>
          )}
        </>
      )}
      {v.locAdding ? (
        <section
          aria-label="Add a location"
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
          <Input
            label="Name"
            required
            placeholder="e.g. Stairwell B"
            maxLength={100}
            value={v.lf.name}
            onChange={v.setLf('name')}
            error={v.lfError ?? undefined}
          />
          <Input
            label="Floor"
            placeholder="e.g. Level 2"
            maxLength={40}
            value={v.lf.floor}
            onChange={v.setLf('floor')}
          />
          <Button variant="primary" iconLeft="plus" loading={v.lfBusy} onClick={v.submitLocation}>
            {'Add location'}
          </Button>
        </section>
      ) : (
        <Button variant="secondary" iconLeft="plus" onClick={v.startAddLocation}>
          {'Add a location'}
        </Button>
      )}
    </div>
  )
}
