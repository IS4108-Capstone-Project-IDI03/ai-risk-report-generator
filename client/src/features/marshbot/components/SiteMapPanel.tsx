// The site map inside the Details panel (AS-06, board D3): the map full width, a round
// "Show my location" button on it, and one row per place (site first, then blocks) in a list that
// scrolls by itself. A pin is placed from the bar under the map (PlacingBar). Everything the old
// Geolocation card did, same logic (assessments/components/siteMapEdit.ts).
// Called by DetailsPanel.tsx. Calls SiteMapView.
import { useRef, useState } from 'react'
import { Icon, IconButton } from '../../../design-system'
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
              <IconButton
                icon="locate-fixed"
                label="Show my location"
                tooltip="Show my location"
                className="mb-hit"
                // Round, white, floating on the map; its tap area grows to 44 px on a phone (mb-hit).
                style={{
                  position: 'absolute',
                  right: 10,
                  bottom: 10,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  color: 'var(--marsh-navy)',
                  background: 'var(--surface-card)',
                  boxShadow: '0 2px 8px rgb(0 15 71 / 0.18)',
                }}
                disabled={locating}
                onClick={() => void showMe()}
              />
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
