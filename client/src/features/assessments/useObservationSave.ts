// Saves changes made in place on the observation page (CP-22) and says how
// the last one went: Saving…, Saved, or why it failed. Used by
// screens/ObservationPage.tsx; the save itself is saveObsChanges in
// useAssessmentWorkflow.tsx.
import { useRef, useState } from 'react'
import type { ObservationChange } from './useAssessmentWorkflow'

type Status = { state: 'idle' | 'saving' | 'saved' } | { state: 'failed'; problem: string }

// Returns the save status, `save` (resolves true once saved) and `whenSaved`.
export function useObservationSave(saveChanges: (change: ObservationChange) => Promise<void>) {
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  // Saves go one at a time: without this, an older save could land after a
  // newer one and undo it (e.g. two quick category clicks).
  const last = useRef<Promise<unknown>>(Promise.resolve())
  const inFlight = useRef(0)
  // How many saves have failed: a later success must not hide an earlier failure.
  const failures = useRef(0)
  async function save(change: ObservationChange) {
    setStatus({ state: 'saving' })
    const mine = last.current.catch(() => {}).then(() => saveChanges(change))
    last.current = mine
    inFlight.current++
    try {
      await mine
    } catch (error: unknown) {
      failures.current++
      // Without this, a refused save would look saved and the change be lost.
      setStatus({
        state: 'failed',
        problem: error instanceof Error ? error.message : 'The change wasn’t saved.',
      })
      return false
    } finally {
      inFlight.current--
    }
    setStatus({ state: 'saved' })
    return true
  }
  // Runs `go` now when no save is on its way; otherwise once they have gone
  // through, and not at all if one fails (the reason shows, and a second try leaves).
  function whenSaved(go: () => void) {
    if (!inFlight.current) return go()
    const before = failures.current
    void last.current
      .catch(() => {})
      .then(() => {
        if (failures.current === before) go()
      })
  }
  return { status, save, whenSaved }
}
