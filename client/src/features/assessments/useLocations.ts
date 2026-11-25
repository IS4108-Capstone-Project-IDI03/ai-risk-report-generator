import { useEffect, useState } from 'react'
import {
  addLocation,
  editLocation,
  listLocations,
  removeLocation,
  type LocationDetails,
  type SiteLocation,
} from './api'

// The assessment's locations, listed from the gateway once `live` (a capture
// session running, or the observations listed). Adding, changing and removing
// always go to the gateway, so a location is never kept only in this browser.
export function useLocations(reference: string, open: boolean, live: boolean) {
  const [server, setServer] = useState<{ reference: string; list: SiteLocation[] } | null>(null)
  // Bumped to list them again, e.g. after a site walk created some (CP-22).
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open || !live) return
    const controller = new AbortController()
    listLocations(reference, controller.signal).then(
      (list) => setServer({ reference, list }),
      () => undefined,
    )
    return () => controller.abort()
  }, [reference, open, live, version])

  const locations = live && server?.reference === reference ? server.list : []
  // Changes the gateway's copy held here, after the gateway accepted the change.
  const change = (update: (list: SiteLocation[]) => SiteLocation[]) =>
    setServer((current) => ({
      reference,
      list: update(current?.reference === reference ? current.list : []),
    }))
  return {
    locations,
    reload: () => setVersion((n) => n + 1),
    // Whether they are the gateway's.
    live,
    // Resolves with the new location, or rejects with the gateway's reason.
    add: async (details: LocationDetails) => {
      const location = await addLocation(reference, details)
      change((list) => [...list, location])
      return location
    },
    // Changes a location in place (CP-16). Rejects with the gateway's reason,
    // e.g. when another location already has those details.
    edit: async (id: string, details: LocationDetails) => {
      const location = await editLocation(reference, id, details)
      change((list) => list.map((l) => (l.id === id ? location : l)))
      return location
    },
    // Rejects with the gateway's reason, e.g. while the location has observations.
    remove: async (id: string) => {
      await removeLocation(reference, id)
      change((list) => list.filter((l) => l.id !== id))
    },
  }
}
