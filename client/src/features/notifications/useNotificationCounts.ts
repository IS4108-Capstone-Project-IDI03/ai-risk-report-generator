// The shared counts' context and the hooks that read it (F-10). Split from the provider so
// that file exports only a component. Provided by NotificationCountsContext.tsx.
import { createContext, useContext, useEffect, useRef } from 'react'
import type { Counts } from './chime'

export type NotificationCountsApi = {
  counts: Counts
  // Records a change the person just made (opened, ticked, binned, undone) or a list's own
  // totals, so the next poll doesn't take it for someone else's.
  change: (update: Partial<Counts> | ((current: Counts) => Counts)) => void
  // Counts each poll that found a count or a newest time moved by someone or something else:
  // never the person's own change. The open list reads itself again when this moves.
  outsideChanges: number
}

export const CountsContext = createContext<NotificationCountsApi | null>(null)

/** Returns the shared counts; throws without a provider. */
export function useNotificationCounts(): NotificationCountsApi {
  const api = useContext(CountsContext)
  if (!api) throw new Error('useNotificationCounts needs a NotificationCountsProvider')
  return api
}

/**
 * Calls `reload` when someone else changed the counts, so an open list follows without a
 * refresh. Returns nothing. A hidden tab waits and reads once when shown: the list routes
 * refresh the session cookie, so reading while hidden would let arrivals keep an idle tab
 * signed in.
 */
export function useReloadOnOutsideChange(reload: () => void) {
  const { outsideChanges } = useNotificationCounts()
  const latestReload = useRef(reload)
  const seenChanges = useRef(outsideChanges)
  const missed = useRef(false)
  useEffect(() => {
    latestReload.current = reload
  })
  useEffect(() => {
    if (outsideChanges === seenChanges.current) return
    seenChanges.current = outsideChanges
    if (document.visibilityState === 'visible') latestReload.current()
    else missed.current = true
  }, [outsideChanges])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !missed.current) return
      missed.current = false
      latestReload.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}
