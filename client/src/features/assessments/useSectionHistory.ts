import { useCallback, useEffect, useState } from 'react'
import { getSectionHistory, type SectionHistory } from './api'

// One section's version history (RV-06): its AI drafts and the versions saved
// in the document editor, oldest first. `reload` reads it again, e.g. after a
// restore was refused because the section was saved since.
export function useSectionHistory(reference: string, sectionId: string) {
  const [history, setHistory] = useState<SectionHistory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getSectionHistory(reference, sectionId, controller.signal).then(
      (read) => {
        // Only a history from the gateway counts.
        if (Array.isArray(read?.entries)) {
          setHistory(read)
          setLoadError(null)
        } else setLoadError('The gateway sent no version history for this section.')
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : 'The version history could not be loaded.',
          )
      },
    )
    return () => controller.abort()
  }, [reference, sectionId, reads])

  const reload = useCallback(() => setReads((n) => n + 1), [])

  return { history, loadError, reload }
}
