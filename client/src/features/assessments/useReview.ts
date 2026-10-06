import { useEffect, useState } from 'react'
import { getReviewWorkspace, type ReviewSection } from './api'

// The assessment's sections 7-12 as the review workspace shows them (RV-01).
export function useReview(reference: string) {
  const [sections, setSections] = useState<ReviewSection[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getReviewWorkspace(reference, controller.signal).then(
      (list) => {
        setSections(list)
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : 'The review workspace could not be loaded.',
          )
      },
    )
    return () => controller.abort()
  }, [reference])

  return { sections, loadError }
}
