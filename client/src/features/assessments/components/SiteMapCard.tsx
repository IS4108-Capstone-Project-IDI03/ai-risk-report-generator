// The Overview's Geolocation card (CP-26): the site and its blocks on a map, each
// with directions, and for the assigned engineer, placing, moving and removing
// pins. Used by screens/Overview.tsx. Saves one change at a time through
// PUT /api/sites/:id/map.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { GatewayError } from '../api'
import { changeSiteMap, type SiteMap, type SiteMapChange } from '../../clients/api'
import { directionsUrl, formatCoordinates, parseCoordinates, type Coordinates } from '../googleMaps'
import { sameName } from '../locations'
import { SiteMapView, type MapPin } from './SiteMapView'

const SITE = 'Site'

// One row: the site, or a block, with its pin if it has one.
type Row = { key: string; name: string; label: string; point: Coordinates | null; block: boolean }

// Every block this visit has, and any pinned on an earlier visit, named once.
function rowsOf(site: SiteMap, buildings: string[]): Row[] {
  const names = [...site.pins.map((p) => p.name)]
  for (const b of buildings) if (!names.some((n) => sameName(n, b))) names.push(b)
  return [
    { key: 'site', name: SITE, label: 'S', point: site.coordinates, block: false },
    ...names.map((name, i) => ({
      key: 'block:' + name,
      name,
      label: String(i + 1),
      point: site.pins.find((p) => sameName(p.name, name)) ?? null,
      block: true,
    })),
  ]
}

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
  // The row whose pin the next map click or pasted coordinates set.
  const [placing, setPlacing] = useState<Row | null>(null)
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rows = rowsOf(site, buildings)

  const save = async (change: SiteMapChange) => {
    setSaving(true)
    setProblem(null)
    try {
      await changeSiteMap(site.id, change)
      setPlacing(null)
      setTyped('')
      // Waited for, so the buttons come back once the card shows the new pin.
      await onSaved('Geolocation saved')
    } catch (error: unknown) {
      setProblem(
        error instanceof GatewayError && error.message
          ? error.message
          : 'The geolocation couldn’t be saved. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const place = (row: Row, point: Coordinates | null) =>
    save(row.block ? { block: row.name, point } : { coordinates: point })

  // A click only places a pin while a row is waiting for one, so panning the
  // map can't move a pin by accident.
  const pick = (point: Coordinates) => {
    if (placing && !saving) void place(placing, point)
  }
  const setFromTyped = () => {
    const point = parseCoordinates(typed)
    if (!point) setProblem('Enter a latitude from -90 to 90 and a longitude from -180 to 180.')
    else if (placing) void place(placing, point)
  }
  const cancel = () => {
    setPlacing(null)
    setProblem(null)
  }
  const start = (row: Row) => {
    setPlacing(row)
    setTyped(row.point ? formatCoordinates(row.point) : '')
    setProblem(null)
  }

  const pins: MapPin[] = rows.flatMap((r) =>
    r.point ? [{ ...r.point, label: r.label, title: r.name }] : [],
  )
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
