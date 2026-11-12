// The site map's places and how one is pinned, moved or removed (CP-26, AS-06 Details panel).
// Called by SiteMapCard.tsx (sample Overview) and marshbot/components/SiteMapPanel.tsx.
// Calls PUT /api/sites/:id/map through clients/api.ts, one change at a time.
import { useState } from 'react'
import { GatewayError } from '../api'
import { changeSiteMap, type SiteMap, type SiteMapChange } from '../../clients/api'
import { formatCoordinates, parseCoordinates, type Coordinates } from '../googleMaps'
import { sameName } from '../locations'
import type { MapPin } from './SiteMapView'

const SITE = 'Site'

// A toast's Undo button (the design system's ToastAction).
export type UndoAction = { label: string; onClick: () => void }

// One row: the site, or a block, with its pin if it has one.
export type PlaceRow = {
  key: string
  name: string
  label: string
  point: Coordinates | null
  block: boolean
}

/** Returns the site, then every block this visit has and any pinned on an earlier visit, named once. */
export function rowsOf(site: SiteMap, buildings: string[]): PlaceRow[] {
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

/** Returns the rows, the pin being placed, and the actions that change pins; saves one change at a time. */
export function useSiteMapEdit(
  site: SiteMap & { id: string },
  buildings: string[],
  // Shows the saved toast (and its Undo, after a removal) once the new pin is in the list.
  onSaved: (message: string, undo?: UndoAction) => void | Promise<void>,
) {
  // The row whose pin the next map click or pasted coordinates set.
  const [placing, setPlacing] = useState<PlaceRow | null>(null)
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rows = rowsOf(site, buildings)

  const save = async (change: SiteMapChange, message: string, undo?: () => void) => {
    setSaving(true)
    setProblem(null)
    try {
      await changeSiteMap(site.id, change)
      setPlacing(null)
      setTyped('')
      // Waited for, so the buttons come back once the card shows the new pin.
      await onSaved(message, undo && { label: 'Undo', onClick: undo })
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

  // Sets, moves or removes a pin and says which. A removal offers Undo, which puts the pin back
  // at its old spot: without it a mis-tap on the bin would silently lose the coordinates.
  const place = (row: PlaceRow, point: Coordinates | null, message?: string): Promise<void> => {
    const was = row.point
    return save(
      row.block ? { block: row.name, point } : { coordinates: point },
      message ?? (!point ? 'Pin removed' : was ? 'Pin moved' : 'Pin set'),
      !point && was
        ? // Only the coordinates: a block's pin also carries its name.
          () => void place(row, { lat: was.lat, lng: was.lng }, 'Pin restored')
        : undefined,
    )
  }

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
  const start = (row: PlaceRow) => {
    setPlacing(row)
    setTyped(row.point ? formatCoordinates(row.point) : '')
    setProblem(null)
  }
  const pins: MapPin[] = rows.flatMap((r) =>
    r.point ? [{ ...r.point, label: r.label, title: r.name }] : [],
  )
  return {
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
  }
}
