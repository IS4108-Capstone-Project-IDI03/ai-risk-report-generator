// Keeps the Recording screen's walk fresh while the server is still working on it
// (CP-22 round 1): re-reads it every 5 s while any recording is waiting to be
// transcribed, and stops once nothing is. Used by useWalk.ts. Calls api.ts getWalk.
import { useEffect } from 'react'
import { getWalk, type SiteWalk } from './api'

const POLL_MS = 5000

// `version` counts the changes made by the screen's own saves. onWalk gets the version
// the poll began at, so it can drop a reply that a save has since overtaken.
export function useWalkPolling(
  reference: string,
  walk: SiteWalk | null,
  stopped: boolean,
  version: number,
  onWalk: (walk: SiteWalk, startedAt: number) => void,
) {
  const waiting = !!walk?.recordings.some(
    (r) => r.transcription === 'queued' || r.transcription === 'transcribing',
  )
  const walkId = walk?.id
  useEffect(() => {
    if (!walkId || !waiting || stopped) return
    const id = setInterval(() => {
      getWalk(reference, walkId)
        .then((fresh) => onWalk(fresh, version))
        .catch(() => {
          // Offline or a blip: the next tick tries again.
        })
    }, POLL_MS)
    return () => clearInterval(id)
  }, [reference, walkId, waiting, stopped, version, onWalk])
}
