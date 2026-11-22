// F-12: lets a screen follow the walkthrough playing now (which step shows) and repeat a signal for a
// step that began after the work was already done. Used by the New Observation form, the Observations
// list and the site walk recorder and review. Calls the walkthrough engine's store and signals.
import { useEffect } from 'react'
import { useWalkthroughs } from '../walkthrough/engine'
import { signal } from '../walkthrough/signals'

/** Returns the step number (from 1) walkthrough `id` shows now, or 0 while it is not playing. */
export function useWalkStep(id: string): number {
  return useWalkthroughs((s) => (s.running?.id === id ? s.running.at : 0))
}

/** Raises `name` while `done` is true and walkthrough `id` waits on it at `step`. Without this, a
    step that began after the work had finished (the AI was quicker than the walkthrough) would wait for ever. */
export function useSignalAtStep(name: string, done: boolean, id: string, step: number): void {
  const waiting = useWalkStep(id) === step
  useEffect(() => {
    if (done && waiting) signal(name)
  }, [name, done, waiting])
}
