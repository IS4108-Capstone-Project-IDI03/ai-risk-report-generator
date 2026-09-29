import { useEffect, useState } from 'react'
import { listObservations, type SavedObservation } from './api'

// The assessment's observations saved on the server: voice notes (CP-03) and
// text notes (CP-02). Transcription finishes after a voice upload returns, so
// the list is re-read every few seconds while any note is still transcribing.
// An unreachable gateway leaves the list as it was.
export function useObservations(reference: string, open: boolean) {
  const [loaded, setLoaded] = useState<{ reference: string; list: SavedObservation[] }>({
    reference,
    list: [],
  })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      listObservations(reference, controller.signal).then(
        (list) => {
          setLoaded({ reference, list })
          if (list.some((o) => o.type === 'voice' && o.transcription.status === 'transcribing'))
            timer = setTimeout(load, 3000)
        },
        () => undefined,
      )
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [reference, open, version])

  return {
    observations: loaded.reference === reference ? loaded.list : [],
    reload: () => setVersion((count) => count + 1),
    // Shows an observation the gateway has just saved without waiting for the
    // list to be re-read.
    add: (observation: SavedObservation) =>
      setLoaded((current) => ({
        reference,
        list: [
          observation,
          ...(current.reference === reference ? current.list : []).filter(
            (o) => o.id !== observation.id,
          ),
        ],
      })),
  }
}
