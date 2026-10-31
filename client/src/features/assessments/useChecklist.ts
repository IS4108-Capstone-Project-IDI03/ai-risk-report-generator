import { useCallback, useEffect, useState } from 'react'
import { getChecklist, listSections, type ChecklistView, type ReportSection } from './api'

// The assessment's pre-survey checklist (CP-30): the site's scope, the
// standards that apply to it and the latest checklist, with the report
// sections, to say how many more observations each needs to be drafted
// (CP-31 AC7). setView lets the screen show what a generation or a mark
// returns; reload reads both again after an answer is saved.
export function useChecklist(reference: string) {
  const [view, setView] = useState<ChecklistView | null>(null)
  const [sections, setSections] = useState<ReportSection[] | null>(null)
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
    // Without them, sections leave out what each needs to be drafted.
    listSections(reference, controller.signal).then(setSections, () => undefined)
    return () => controller.abort()
  }, [reference])

  const reload = useCallback(async () => {
    setView(await getChecklist(reference))
    listSections(reference).then(setSections, () => undefined)
  }, [reference])

  return { view, setView, sections, loadError, reload }
}
