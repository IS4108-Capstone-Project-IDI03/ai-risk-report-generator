// The Comparison tab's data (RV-13): read when the tab opens and when another
// previous report is picked, a comparison run on request, and each decision
// saved. Every gateway answer is the whole tab, so counts, New items and the
// out-of-date note always come from the gateway. Called by ComparisonTab;
// calls the gateway through api.ts.
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../../design-system'
import { GatewayError } from '../api'
import { decideItem, getComparison, runComparison, type ComparisonPage, type Decision } from './api'

const UNREACHABLE = "Can't reach the server. Check your connection, then try again."
const reasonOf = (error: unknown) =>
  error instanceof GatewayError && error.status !== null ? error.message : UNREACHABLE

// Why a run stopped and when, for "Comparison stopped at 14:02" (AC "Failures").
export type RunFailure = { message: string; at: Date }

// The tab as last read, and for which assessment and report.
type Loaded = { key: string; page: ComparisonPage }

// What a refused decision says: its reason, and the field it is about.
export type DecisionRefusal = { message: string; fields: Record<string, string> }

const DONE: Record<Decision['action'], string> = {
  accept: 'Outcome accepted',
  outcome: 'Outcome changed',
  pair: 'Pairing saved',
  unpair: 'Unpaired',
  dismiss: 'Item dismissed',
  restore: 'Item restored',
}

export function useComparison(reference: string) {
  // The previous report picked; null until the engineer picks one, so the gateway's
  // default (the latest) is shown.
  const [previous, setPrevious] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<RunFailure | null>(null)
  const [deciding, setDeciding] = useState(false)
  const key = `${reference}|${previous ?? ''}`

  useEffect(() => {
    const controller = new AbortController()
    getComparison(reference, previous, controller.signal).then(
      (page) => {
        setLoaded({ key, page })
        setError(null)
      },
      (failed: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(failed))
      },
    )
    return () => controller.abort()
  }, [reference, previous, key])

  const page = loaded?.key === key ? loaded.page : null

  const pick = useCallback((reportReference: string) => {
    setFailure(null)
    setPrevious(reportReference)
  }, [])

  // Compare with previous report, or Compare again. A failed run is kept by the gateway
  // with its reason and time; the last comparison stays (AC "Failures").
  const run = useCallback(async () => {
    const chosen = previous ?? page?.previous?.reference
    if (!chosen) return
    setRunning(true)
    setFailure(null)
    try {
      const next = await runComparison(reference, chosen)
      setLoaded({ key, page: next })
      toast.success('Comparison done')
    } catch (failed: unknown) {
      const at =
        failed instanceof GatewayError && typeof failed.detail.failedAt === 'string'
          ? new Date(failed.detail.failedAt)
          : new Date()
      setFailure({ message: reasonOf(failed), at })
    }
    setRunning(false)
  }, [reference, previous, page?.previous?.reference, key])

  // One decision on one item: the tab as the gateway now has it, or why it was refused.
  const decide = useCallback(
    async (item: string, decision: Decision) => {
      const comparison = page?.comparison
      if (!comparison) return { message: 'Run the comparison first.', fields: {} }
      setDeciding(true)
      try {
        const next = await decideItem(reference, comparison.id, item, decision)
        setLoaded({ key, page: next })
        toast.success(DONE[decision.action])
        return null
      } catch (failed: unknown) {
        const refusal: DecisionRefusal = {
          message: reasonOf(failed),
          fields: failed instanceof GatewayError ? failed.fields : {},
        }
        // A field's problem is shown under the field; anything else as a toast.
        if (!Object.keys(refusal.fields).length) toast.error(refusal.message)
        return refusal
      } finally {
        setDeciding(false)
      }
    },
    [reference, page?.comparison, key],
  )

  return { page, error, running, failure, deciding, pick, run, decide }
}
