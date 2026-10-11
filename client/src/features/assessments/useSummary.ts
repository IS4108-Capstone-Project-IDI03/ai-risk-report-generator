// Sections 1 and 2 for one assessment (GN-07). Used by the Review tab and the
// Section 2 row on the Generation tab. Calls GET /summary (api.ts).
import { useCallback, useEffect, useState } from 'react'
import { getSummary, type Summary } from './api'

// Sections 1 and 2 as the gateway has them. They are fetched again whenever
// `refreshKey` changes (e.g. a section was drafted, so fewer are missing), and
// on reload, e.g. after the Executive Summary is drafted.
export function useSummary(reference: string, refreshKey = '') {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(
    (signal?: AbortSignal) =>
      getSummary(reference, signal).then(
        (s) => {
          // Only a summary from the gateway counts; anything else reads as not loaded.
          setSummary(s?.executiveSummary ? s : null)
          setLoadError(null)
        },
        (error: unknown) => {
          if (!signal?.aborted)
            setLoadError(
              error instanceof Error ? error.message : 'Sections 1 and 2 could not be loaded.',
            )
        },
      ),
    [reference],
  )

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload, refreshKey])

  return { summary, loadError, reload }
}
