// The Overview's Geolocation card (CP-26): the site and its blocks on a map, each
// with directions, and for the assigned engineer, placing, moving and removing
// pins. Used by screens/Overview.tsx. Saves one change at a time through
// PUT /api/sites/:id/map.
import { Button, Icon, Input } from '../../../design-system'
import type { SiteMap } from '../../clients/api'
import { directionsUrl, formatCoordinates } from '../googleMaps'
import { MyLocationButton } from './MyLocationButton'
import { useSiteMapEdit } from './siteMapEdit'
import { SiteMapView } from './SiteMapView'

export function SiteMapCard({
  site,
  buildings,
  canEdit,
  onSaved,
}: {
  site: SiteMap & { id: string }
  buildings: string[]
  canEdit: boolean
  onSaved: (message: string) => void | Promise<void>
}) {
  const {
    rows,
    pins,
    placing,
    typed,
    setTyped,
    problem,
    saving,
    place,
    pick,
    setFromTyped,
    cancel,
    start,
  } = useSiteMapEdit(site, buildings, onSaved)
  return (
    <section aria-label="Geolocation" className="sm-card">
      <div className="sm-head">
        {'Geolocation'}
        {canEdit && !site.coordinates && !placing && (
          <Button variant="ghost" size="sm" iconLeft="map-pin" onClick={() => start(rows[0])}>
            {'Add site location'}
          </Button>
        )}
      </div>
      <SiteMapView
        label={'Map of the site'}
        pins={pins}
        onPick={pick}
        // While placing, a click on a pin means this spot, not directions.
        onPinClick={(pin) =>
          placing
            ? pick({ lat: pin.lat, lng: pin.lng })
            : window.open(directionsUrl(pin), '_blank', 'noreferrer')
        }
      />
      {placing && (
        <div className="sm-placing">
          <p>{'Click the map to place ' + placing.name + ', or paste its coordinates.'}</p>
          <MyLocationButton
            key={placing.key}
            disabled={saving}
            onFound={(point) => place(placing, point)}
          />
          <div className="sm-placing-row">
            <Input
              label="Coordinates"
              placeholder="e.g. 1.2966, 103.8520"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button size="sm" disabled={saving} onClick={setFromTyped}>
              {'Set'}
            </Button>
            <Button variant="ghost" size="sm" disabled={saving} onClick={cancel}>
              {'Cancel'}
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p className="sm-problem" role="alert">
          <Icon name="circle-alert" size={14} />
          {problem}
        </p>
      )}
      <ul className="sm-rows">
        {rows.map((row) => (
          <li key={row.key} aria-label={row.name} className="sm-row">
            <span className="sm-badge">{row.label}</span>
            <span className="sm-name" dir="auto">
              {row.name}
              <small>{row.point ? formatCoordinates(row.point) : 'Not pinned'}</small>
            </span>
            {row.point && (
              <a href={directionsUrl(row.point)} target="_blank" rel="noreferrer">
                <Icon name="navigation" size={14} />
                {'Directions'}
              </a>
            )}
            {canEdit && (
              <span className="sm-actions">
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => start(row)}>
                  {row.point ? 'Move' : 'Pin'}
                </Button>
                {row.point && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void place(row, null)}
                  >
                    {'Remove'}
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
