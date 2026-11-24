// Tracks one save (idle, saving, failed) for a Settings control, and toasts the good news. S-01.
// Used by every section. Without the failed state a rejected save would look like it worked.
import { useState } from 'react'
import { toast } from '../../design-system'
import { GatewayError } from '../assessments/api'
import type { Settings } from './api'

export type SaveState = { status: 'idle' | 'saving' | 'failed'; message: string }

/** Returns the save state, a `run` and a `reset`; `run` calls the save and hands the new settings on. */
export function useSave(onSaved: (settings: Settings) => void) {
  const [state, setState] = useState<SaveState>({ status: 'idle', message: '' })
  // `done` is the success toast's words; `undo` adds an Undo button that saves the old value back.
  // A failure stays inline beside the control, so the person sees which save did not work.
  const run = async (save: () => Promise<Settings>, done?: string, undo?: () => void) => {
    setState({ status: 'saving', message: '' })
    try {
      onSaved(await save())
      setState({ status: 'idle', message: '' })
      if (done && undo) toast.success(done, { action: { label: 'Undo', onClick: undo } })
      else if (done) toast.success(done)
    } catch (error) {
      const message = error instanceof GatewayError ? error.message : 'Could not save.'
      setState({ status: 'failed', message })
    }
  }
  // Back to idle: a new action starts by clearing the last result, so none shows stale.
  const reset = () => setState({ status: 'idle', message: '' })
  return { state, run, reset }
}
