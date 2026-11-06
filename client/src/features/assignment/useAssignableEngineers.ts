// Loads the people an admin can assign work to (RV-11), once, while `enabled`.
// Used by the New Assessment form and the Reassign dialog. Calls api.ts.
import { useEffect, useState } from 'react'
import { listAssignableEngineers, type Person } from './api'

/** Returns the people, or null while loading, and whether the call failed. */
export function useAssignableEngineers(enabled: boolean) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listAssignableEngineers(controller.signal).then(setPeople, () => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => controller.abort()
  }, [enabled])
  return { people, failed }
}
