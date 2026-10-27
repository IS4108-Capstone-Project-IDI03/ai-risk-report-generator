import { useEffect, useState } from 'react'
import { getChecklist, type ChecklistView } from './api'

// The assessment's pre-survey checklist (CP-30): the site's scope, the
// standards that apply to it and the latest checklist. setView lets the
// screen show what a generation returns.
export function useChecklist(reference: string) {
  const [view, setView] = useState<ChecklistView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getChecklist(reference, controller.signal).then(
      (loaded) => {
        setView(loaded)
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : 'The checklist could not be loaded.',
          )
      },
    )
    return () => controller.abort()
  }, [reference])

  return { view, setView, loadError }
}
