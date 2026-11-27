// The assessment's site walks for the Observations tab's banner (CP-22 AC5):
// polls while any walk is still being read, so "ready" appears without a reload.
import { useCallback, useEffect, useState } from 'react'
import { listWalks, type SiteWalk } from './api'

export const POLL_MS = 10_000

// Returns the walks (newest first), whether the first read has answered, and a way to reload them.
export function useSiteWalks(reference: string) {
  const [walks, setWalks] = useState<SiteWalk[]>([])
  // Without this, the list flashed "No site walk proposals yet" before the first read landed.
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const busy = walks.some((w) => w.status === 'transcribing' || w.status === 'proposing')

  useEffect(() => {
    const ctrl = new AbortController()
    listWalks(reference, ctrl.signal)
      .then(setWalks)
      // The banner is a convenience; a failed check keeps the last list.
      .catch(() => {})
      .finally(() => !ctrl.signal.aborted && setLoaded(true))
    return () => ctrl.abort()
  }, [reference, version])

  useEffect(() => {
    if (!busy) return
    const id = setInterval(reload, POLL_MS)
    return () => clearInterval(id)
  }, [busy, reload])

  return { walks, loaded, reload }
}
