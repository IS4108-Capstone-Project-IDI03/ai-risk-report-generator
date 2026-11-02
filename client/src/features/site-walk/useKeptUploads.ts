// Sends site-walk recordings and photos still kept on the device (CP-22 AC4),
// from the Observations tab: when it opens and when the connection returns.
// Used by assessments/screens/Observations.tsx. Calls pendingUploads.ts.
import { useEffect, useState } from 'react'
import {
  deviceStore,
  sendUpload,
  uploadQueue,
  type PendingUpload,
  type UploadStore,
} from './pendingUploads'

// Returns how many of this assessment's uploads are still waiting. `onSent`
// runs after a send that cleared something, so the walks list can refresh.
export function useKeptUploads(
  reference: string,
  onSent: () => void,
  store?: UploadStore,
  send: (item: PendingUpload) => Promise<unknown> = sendUpload,
) {
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    const kept = store ?? deviceStore()
    const queue = uploadQueue(kept, send)
    let alive = true
    async function flush() {
      const before = (await kept.all()).filter((i) => i.reference === reference)
      const walkIds = [...new Set(before.map((i) => i.walkId))]
      const left = (await Promise.all(walkIds.map((id) => queue.flush(id)))).flat()
      if (!alive) return
      setWaiting(left.length)
      if (left.length < before.length) onSent()
    }
    void flush()
    const online = () => void flush()
    window.addEventListener('online', online)
    return () => {
      alive = false
      window.removeEventListener('online', online)
    }
    // The store, send and onSent are fixed for a screen's life; only the assessment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference])

  return waiting
}
