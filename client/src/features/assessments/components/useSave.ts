import { useState } from 'react'

// Runs a dialog's save, keeping the dialog open with the reason when it fails
// (CP-08 AC18). On success the workflow closes the dialog. Used by the
// observation dialogs and the location removal dialog.
export function useSave() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (save: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await save()
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Nothing was saved. Try again.')
    }
    setBusy(false)
  }
  return { busy, problem, run }
}
