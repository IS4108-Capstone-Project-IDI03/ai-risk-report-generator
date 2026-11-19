// Tracks one save (idle, saving, saved, failed) for a Settings control. S-01.
// Used by every section. Without the failed state a rejected save would look like it worked.
import { useState } from 'react'
import { GatewayError } from '../assessments/api'
import type { Settings } from './api'

export type SaveState = { status: 'idle' | 'saving' | 'saved' | 'failed'; message: string }

/** Returns the save state, a `run` and a `reset` that calls the save and hands the new settings on. */
export function useSave(onSaved: (settings: Settings) => void) {
  const [state, setState] = useState<SaveState>({ status: 'idle', message: '' })
  const run = async (save: () => Promise<Settings>) => {
    setState({ status: 'saving', message: '' })
    try {
      onSaved(await save())
      setState({ status: 'saved', message: '' })
    } catch (error) {
      const message = error instanceof GatewayError ? error.message : 'Could not save.'
      setState({ status: 'failed', message })
    }
  }
  // Back to idle: a new action starts by clearing the last result, so none shows stale.
  const reset = () => setState({ status: 'idle', message: '' })
  return { state, run, reset }
}
