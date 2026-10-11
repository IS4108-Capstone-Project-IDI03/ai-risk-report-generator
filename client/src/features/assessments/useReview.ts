import { useCallback, useEffect, useState } from 'react'
import { getReviewWorkspace, type ReviewWorkspace } from './api'

// The assessment's sections 7-12 as the review workspace shows them (RV-01),
// with the engineer's decisions and the review summary (RV-02).
// `keep` shows a workspace a decision returned; of responses that overlap, as
// when a regeneration finishes after a later decision, the newest read wins.
// `reload` reads it again, e.g. after a decision was refused as out of date.
export function useReview(reference: string) {
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)

  const keep = useCallback((next: ReviewWorkspace) => {
    setWorkspace((current) =>
      current?.asOf && next.asOf && next.asOf < current.asOf ? current : next,
    )
    setLoadError(null)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    getReviewWorkspace(reference, controller.signal).then(keep, (error: unknown) => {
      if (!controller.signal.aborted)
        setLoadError(
          error instanceof Error ? error.message : 'The review workspace could not be loaded.',
        )
    })
    return () => controller.abort()
  }, [reference, reads, keep])

  const reload = useCallback(() => setReads((n) => n + 1), [])

  return { sections: workspace?.sections ?? null, workspace, loadError, keep, reload }
}
