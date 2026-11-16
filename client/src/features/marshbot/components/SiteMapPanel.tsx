// The site map inside the Details panel (AS-06, board D3): the map full width, a round
// "Show My Location" button on it, and one row per place (site first, then blocks) in a list that
// scrolls by itself. A pin is placed from the bar under the map (PlacingBar). Everything the old
// Geolocation card did, same logic (assessments/components/siteMapEdit.ts).
// Called by DetailsPanel.tsx. Calls SiteMapView.
import { useEffect, useRef, useState } from 'react'
import { Icon, IconAction } from '../../../design-system'
import { useSiteMapEdit, type UndoAction } from '../../assessments/components/siteMapEdit'
import { SiteMapView } from '../../assessments/components/SiteMapView'
import { directionsUrl, type Coordinates } from '../../assessments/googleMaps'
import { currentPosition } from '../../assessments/myLocation'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { PlacingBar } from './PlacingBar'
import { SiteMapPlace } from './SiteMapPlace'
import './details.css'

/** Returns the site map; `map` is the workflow's ovMap, `onSaved` shows the saved toast. */
export function SiteMapPanel({
  map,
  onSaved,
}: {
  map: NonNullable<AssessmentWorkflow['ovMap']>
  onSaved: (message: string, undo?: UndoAction) => void | Promise<void>
}) {
  const edit = useSiteMapEdit(map.site, map.buildings, onSaved)
  const { rows, placing, saving } = edit
  const panel = useRef<HTMLDivElement>(null)
  // The row button that opened the bar. When the bar closes (Cancel, or after a save) focus goes
  // back to it, or to that row's button if a save swapped it, so the keyboard is not lost.
  const opener = useRef<string | null>(null)
  const barWasOpen = useRef(false)
  const closing = !placing
  useEffect(() => {
    if (!closing) {
      barWasOpen.current = true
      return
    }
    // Not while a save is still running: the row buttons are disabled until it ends, and a
    // disabled button can't take focus (it would be lost with the bar).
    if (saving || !barWasOpen.current || !opener.current) return
    barWasOpen.current = false
    const name = opener.current
    // Found by the row's name, not kept from the press: a save swaps the button, and Safari
    // does not focus a clicked button, so there is no focused element to remember.
    const back = [...(panel.current?.querySelectorAll('li.mb-place') ?? [])]
      .find((li) => li.getAttribute('aria-label') === name)
      ?.querySelector<HTMLElement>('.mb-place-actions button:not([disabled])')
    // No scroll: on a phone the sheet has just been scrolled to the map and the new pin.
    back?.focus({ preventScroll: true })
  }, [closing, saving])
  const [focus, setFocus] = useState<Coordinates | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateProblem, setLocateProblem] = useState<string | null>(null)
  // Pinned places first, so the ones with something to show stay in view.
  const ordered = [...rows.filter((r) => r.point), ...rows.filter((r) => !r.point)]

  // The round button: centre the map on where the engineer is. Changes nothing saved.
  const showMe = async () => {
    setLocating(true)
    setLocateProblem(null)
    try {
      setFocus({ ...(await currentPosition()).point })
    } catch (error: unknown) {
      setLocateProblem(error instanceof Error ? error.message : 'We couldn’t find you. Try again.')
    } finally {
      setLocating(false)
    }
  }

  const problem = edit.problem ?? locateProblem
  return (
    <div ref={panel} className="mb-sitemap">
      <div className="mb-mapbox" data-placing={placing ? '' : undefined}>
        <SiteMapView
          label="Map of the site"
          pins={edit.pins}
          focus={focus}
          overlay={
            placing ? (
              <p className="mb-maphint">
                <Icon name="crosshair" size={16} color="var(--marsh-navy)" />
                <span>
                  {'Click the map to place '}
                  <b>{placing.name}</b>
                </span>
              </p>
            ) : (
              <span className="mb-locate">
                <IconAction
                  icon="locate-fixed"
                  label="Show My Location"
                  // The map clips anything past its box: the tooltip grows leftwards from the button.
                  placement="top-end"
                  size="md"
                  className="mb-hit"
                  // Round, white, floating on the map; its tap area grows to 44 px on a phone (mb-hit).
                  style={{
                    width: 36,
                    height: 36,
                    color: 'var(--marsh-navy)',
                    background: 'var(--surface-card)',
                    boxShadow: 'var(--shadow-md)',
                  }}
                  loading={locating}
                  onClick={() => void showMe()}
                />
              </span>
            )
          }
          onPick={edit.pick}
          // While placing, a click on a pin means this spot, not directions.
          onPinClick={(pin) =>
            placing
              ? edit.pick({ lat: pin.lat, lng: pin.lng })
              : window.open(directionsUrl(pin), '_blank', 'noreferrer')
          }
        />
      </div>
      {placing && (
        <PlacingBar
          key={placing.key}
          typed={edit.typed}
          onTyped={edit.setTyped}
          onSet={edit.setFromTyped}
          onCancel={() => {
            edit.cancel()
            setLocateProblem(null)
          }}
          onProblem={setLocateProblem}
          busy={saving}
        />
      )}
      {problem && (
        <p className="mb-mapproblem" role="alert">
          <Icon name="circle-alert" size={14} />
          {problem}
        </p>
      )}
      {/* Every place; only this list scrolls, so the map and the bar stay put. */}
      <div className="mb-placelist">
        <ul>
          {ordered.map((row) => (
            <SiteMapPlace
              key={row.key}
              row={row}
              canEdit={map.canEdit}
              busy={saving}
              current={placing?.key === row.key}
              onCentre={() => row.point && setFocus({ ...row.point })}
              onPlace={() => {
                opener.current = row.name
                setLocateProblem(null)
                edit.start(row)
                // On a phone the sheet scrolls: bring the map and the bar back into view, or a
                // press on a lower row would leave them above the screen.
                panel.current?.scrollIntoView?.({ block: 'start' })
              }}
              onRemove={() => void edit.place(row, null)}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
