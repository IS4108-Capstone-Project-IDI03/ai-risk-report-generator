import { useEffect, useState } from 'react'
import { listObservations, type SavedObservation } from './api'

// The assessment's observations saved on the server. Transcription finishes
// after a save returns, so the list is re-read every few seconds while any
// recording is still transcribing. Deleted ones (CP-08) are read too while
// includeDeleted asks for them, for the Observations tab's Show deleted.
// An unreachable gateway leaves the list as it was.
export function useObservations(reference: string, open: boolean, includeDeleted = false) {
  // synced: the gateway has listed this assessment's observations, so it holds
  // the assessment.
  const [loaded, setLoaded] = useState<{
    reference: string
    list: SavedObservation[]
    synced: boolean
  }>({ reference, list: [], synced: false })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      listObservations(reference, controller.signal, includeDeleted).then(
        (list) => {
          setLoaded({ reference, list, synced: true })
          if (list.some((o) => o.recordings.some((r) => r.transcription.status === 'transcribing')))
            timer = setTimeout(load, 3000)
        },
        () => undefined,
      )
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [reference, open, version, includeDeleted])

  const current = loaded.reference === reference ? loaded : null
  const list = current?.list ?? []
  return {
    // Deleted ones never show here, so capture and the default list leave them out.
    observations: list.filter((o) => !o.deleted),
    deleted: list.filter((o) => o.deleted),
    synced: !!current?.synced,
    reload: () => setVersion((count) => count + 1),
    // Shows an observation the gateway has just saved without waiting for the
    // list to be re-read.
    add: (observation: SavedObservation) =>
      setLoaded((previous) => ({
        reference,
        list: [
          observation,
          ...(previous.reference === reference ? previous.list : []).filter(
            (o) => o.id !== observation.id,
          ),
        ],
        synced: true,
      })),
    // Shows an observation the gateway has just changed, in its place. One
    // just deleted or restored moves between the two lists above.
    replace: (observation: SavedObservation) =>
      setLoaded((previous) =>
        previous.reference === reference
          ? {
              ...previous,
              list: previous.list.map((o) => (o.id === observation.id ? observation : o)),
            }
          : previous,
      ),
  }
}
