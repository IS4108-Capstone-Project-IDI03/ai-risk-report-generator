// The fixed checklist items for Settings > Checklist (CP-37). Called by
// screens/ChecklistSection.tsx. Calls getFixedItems in api.ts.
import { useCallback, useEffect, useState } from 'react'
import { GatewayError } from '../assessments/api'
import { getFixedItems, type FixedItems } from './api'

/** Returns the site types and fixed items (null while loading), a load error and reload. */
export function useFixedItems() {
  const [data, setData] = useState<FixedItems | null>(null)
  const [problem, setProblem] = useState('')
  const reload = useCallback(
    () =>
      getFixedItems().then(
        (d) => {
          setData(d)
          setProblem('')
        },
        (error: unknown) =>
          setProblem(
            error instanceof GatewayError && error.message
              ? error.message
              : 'Could not load the fixed items.',
          ),
      ),
    [],
  )
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, problem, reload }
}
