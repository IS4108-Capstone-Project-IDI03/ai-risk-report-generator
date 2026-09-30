import { Button, Callout, Dialog, Icon, IconButton, Input } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// Where the engineer picks, searches for or adds the location they are
// capturing in. A bottom sheet on phones, a dialog on wider screens. Until a
// location is chosen it cannot be dismissed, only left with the capture screen.
export function LocationSheet({ v }: { v: AssessmentWorkflow }) {
  return (
    <Dialog
      className="ds-dialog-sheet"
      open={v.locSheetOpen}
      title="Where are you?"
      description="Observations are saved to the location you choose."
      width={440}
      onClose={v.canCloseLocations ? v.closeLocations : undefined}
      footer={
        !v.canCloseLocations && (
          <Button variant="ghost" onClick={v.goDash}>
            {'Leave capture'}
          </Button>
        )
      }
    >
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
            {!!v.locError && (
              <div role="alert">
                <Callout tone="warning" title="Location not removed">
                  {v.locError}
                </Callout>
              </div>
            )}
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
    </Dialog>
  )
}
