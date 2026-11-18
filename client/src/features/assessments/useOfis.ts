import { useCallback, useEffect, useState } from 'react'
import { listOfis, type OfiList } from './api'

// The assessment's Section 3 OFIs: suggestions and accepted ones (GN-05).
// setOfis lets the screen show the list a draft or an accept returns; reload reads it
// again, e.g. once Section 3 was redrafted in the background (GN-13).
export function useOfis(reference: string) {
  const [ofis, setOfis] = useState<OfiList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listOfis(reference, controller.signal).then(
      (list) => {
        setOfis(list)
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'The Opportunities for Improvement could not be loaded.',
          )
      },
    )
    return () => controller.abort()
  }, [reference, reads])

  const reload = useCallback(() => setReads((n) => n + 1), [])

  return { ofis, setOfis, loadError, reload }
}
