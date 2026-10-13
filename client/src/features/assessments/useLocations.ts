import { useEffect, useState } from 'react'
import {
  addLocation,
  editLocation,
  listLocations,
  removeLocation,
  type LocationDetails,
  type SiteLocation,
} from './api'

// A location kept in this browser, from the details given.
const localLocation = (id: string, details: LocationDetails): SiteLocation => ({
  id,
  building: details.building?.trim() || null,
  floor: details.floor?.trim() || null,
  name: details.name.trim(),
})

// The assessment's locations. With a capture session live they come from the
// gateway and new ones are saved there; otherwise they stay in this browser,
// starting from `demo` (the sample assessment's places).
export function useLocations(
  reference: string,
  open: boolean,
  live: boolean,
  demo: SiteLocation[],
) {
  const [server, setServer] = useState<{ reference: string; list: SiteLocation[] } | null>(null)
  const [local, setLocal] = useState<Record<string, SiteLocation[]>>({})

  useEffect(() => {
    if (!open || !live) return
    const controller = new AbortController()
    listLocations(reference, controller.signal).then(
      (list) => setServer({ reference, list }),
      () => undefined,
    )
    return () => controller.abort()
  }, [reference, open, live])

  const locations = live
    ? server?.reference === reference
      ? server.list
      : []
    : (local[reference] ?? demo)
  // Changes the list for this reference, on the gateway's copy or this browser's.
  const change = (update: (list: SiteLocation[]) => SiteLocation[]) => {
    if (live)
      setServer((current) => ({
        reference,
        list: update(current?.reference === reference ? current.list : []),
      }))
    else setLocal((current) => ({ ...current, [reference]: update(current[reference] ?? demo) }))
  }
  return {
    locations,
    // Whether they are the gateway's.
    live,
    // Resolves with the new location, or rejects with the gateway's reason.
    add: async (details: LocationDetails) => {
      const location = live
        ? await addLocation(reference, details)
        : localLocation('local-' + Date.now(), details)
      change((list) => [...list, location])
      return location
    },
    // Changes a location in place (CP-16). Rejects with the gateway's reason,
    // e.g. when another location already has those details.
    edit: async (id: string, details: LocationDetails) => {
      const location = live
        ? await editLocation(reference, id, details)
        : localLocation(id, details)
      change((list) => list.map((l) => (l.id === id ? location : l)))
      return location
    },
    // Rejects with the gateway's reason, e.g. while the location has observations.
    remove: async (id: string) => {
      if (live) await removeLocation(reference, id)
      change((list) => list.filter((l) => l.id !== id))
    },
  }
}
