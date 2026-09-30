import { useEffect, useState } from 'react'
import { addLocation, listLocations, removeLocation, type SiteLocation } from './api'

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
  return {
    locations,
    // Resolves with the new location, or rejects with the gateway's reason.
    add: async (details: { name: string; floor?: string }) => {
      if (live) {
        const location = await addLocation(reference, details)
        setServer((current) => ({
          reference,
          list: [...(current?.reference === reference ? current.list : []), location],
        }))
        return location
      }
      const location = {
        id: 'local-' + Date.now(),
        name: details.name.trim(),
        floor: details.floor?.trim() || null,
      }
      setLocal((current) => ({
        ...current,
        [reference]: [...(current[reference] ?? demo), location],
      }))
      return location
    },
    // Rejects with the gateway's reason, e.g. while the location has observations.
    remove: async (id: string) => {
      if (live) {
        await removeLocation(reference, id)
        setServer((current) =>
          current?.reference === reference
            ? { reference, list: current.list.filter((l) => l.id !== id) }
            : current,
        )
        return
      }
      setLocal((current) => ({
        ...current,
        [reference]: (current[reference] ?? demo).filter((l) => l.id !== id),
      }))
    },
  }
}
