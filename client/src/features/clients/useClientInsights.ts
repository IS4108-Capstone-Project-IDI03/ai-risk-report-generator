// The Insights tab's data (CP-29): read when the tab is first opened and each
// time it is opened again, and the summary written on request. Called by
// screens/InsightsTab.tsx; calls the gateway through api.ts.
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { getClientInsights, writeInsightSummary, type ClientInsights } from './api'

const UNREACHABLE = "Can't reach the server. Check your connection and try again."
const reasonOf = (error: unknown) =>
  error instanceof GatewayError && error.status !== null ? error.message : UNREACHABLE

// Why the summary was not written, and when, for "Summary stopped at 14:02".
export type WriteFailure = { message: string; at: Date }

export function useClientInsights(clientId: string, open: boolean) {
  const [loaded, setLoaded] = useState<{ id: string; insights: ClientInsights } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [failure, setFailure] = useState<WriteFailure | null>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getClientInsights(clientId, controller.signal).then(
      (insights) => {
        setLoaded({ id: clientId, insights })
        setError(null)
      },
      (failed: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(failed))
      },
    )
    return () => controller.abort()
  }, [clientId, open])

  // Writes a new summary; the figures stay as they were read.
  const write = useCallback(async () => {
    setWriting(true)
    setFailure(null)
    try {
      const summary = await writeInsightSummary(clientId)
      setLoaded((now) =>
        now?.id === clientId ? { id: clientId, insights: { ...now.insights, summary } } : now,
      )
      toast.success('Summary written')
    } catch (failed: unknown) {
      setFailure({ message: reasonOf(failed), at: new Date() })
    }
    setWriting(false)
  }, [clientId])

  return {
    // What was read for another client is never shown for this one.
    insights: loaded?.id === clientId ? loaded.insights : null,
    error,
    writing,
    failure,
    write,
  }
}
