import { useEffect, useState } from 'react'
import { listObservations, type VoiceObservation } from './api'

// The assessment's saved voice observations (CP-03). Transcription finishes
// after the upload returns, so the list is re-read every few seconds while any
// note is still transcribing. An unreachable gateway leaves the list as it was.
export function useVoiceObservations(reference: string, open: boolean) {
  const [loaded, setLoaded] = useState<{ reference: string; list: VoiceObservation[] }>({
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
          if (list.some((o) => o.transcription.status === 'transcribing'))
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
  }
}
