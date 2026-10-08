import { useEffect, useState } from 'react'
import { listOfis, type OfiList } from './api'

// The assessment's Section 3 OFIs: suggestions and accepted ones (GN-05).
// setOfis lets the screen show the list a draft or an accept returns.
export function useOfis(reference: string) {
  const [ofis, setOfis] = useState<OfiList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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
  }, [reference])

  return { ofis, setOfis, loadError }
}
