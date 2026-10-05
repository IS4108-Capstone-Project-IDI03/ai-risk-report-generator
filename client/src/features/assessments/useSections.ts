import { useEffect, useState } from 'react'
import { listSections, type ReportSection } from './api'

// The assessment's report sections 7-12 with their newest drafts (GN-01).
// setSections lets a screen show a draft it has just saved.
export function useSections(reference: string) {
  const [sections, setSections] = useState<ReportSection[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listSections(reference, controller.signal).then(
      (list) => {
        setSections(list)
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : 'The sections could not be loaded.')
      },
    )
    return () => controller.abort()
  }, [reference])

  return { sections, setSections, loadError }
}
