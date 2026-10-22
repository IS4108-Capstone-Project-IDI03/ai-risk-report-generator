// Sections 4 and 5's figures for one assessment (GN-03): loads them, and saves the
// engineer's inputs, keeping the gateway's computed result. Used by
// components/RiskQualityFigures.tsx and LossEstimateFigures.tsx. Calls api.ts.
import { useEffect, useState } from 'react'
import { GatewayError } from './api'

// `onSaved` lets the review workspace reload, so "out of date" and what Generation
// can draft follow the new figures.
export function useFigures<T, Input>(
  reference: string,
  get: (reference: string, signal: AbortSignal) => Promise<T>,
  put: (reference: string, input: Input) => Promise<T>,
  onSaved?: () => void,
  // Asks the model to propose the figures (GN-03 addendum); the answer is the figures
  // with their proposal, which the form shows until the engineer confirms.
  ask?: (reference: string) => Promise<T>,
) {
  const [figures, setFigures] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [proposing, setProposing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    get(reference, controller.signal).then(setFigures, (e: unknown) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'The figures could not be loaded.')
    })
    return () => controller.abort()
  }, [reference, get])

  const save = async (input: Input) => {
    setSaving(true)
    setError(null)
    try {
      setFigures(await put(reference, input))
      onSaved?.()
    } catch (e: unknown) {
      // A refused save names the rule it broke (e.g. months over the indemnity period).
      setError(
        e instanceof GatewayError
          ? // Each rule once: several rows can break the same one.
            [...new Set([e.message, ...Object.values(e.fields)])].join(' ')
          : 'The figures were not saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  const propose = async () => {
    if (!ask) return
    setProposing(true)
    setError(null)
    try {
      setFigures(await ask(reference))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'The figures could not be proposed.')
    } finally {
      setProposing(false)
    }
  }

  return { figures, error, saving, save, proposing, propose }
}
