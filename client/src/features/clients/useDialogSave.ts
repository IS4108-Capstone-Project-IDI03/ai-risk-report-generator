import { useState } from 'react'
import { GatewayError } from '../assessments/api'

// Runs a dialog's save, keeping the dialog open with the reason when it
// fails, and each refused field beside its control, so what was typed stays
// (CP-08 AC18). The client and site dialogs (CP-18) and Edit details use it.
export function useDialogSave() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const run = async (save: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    setFields({})
    try {
      await save()
    } catch (error: unknown) {
      if (error instanceof GatewayError && Object.keys(error.fields).length) setFields(error.fields)
      else
        setProblem(
          error instanceof GatewayError && error.status === null
            ? 'The gateway could not be reached. Nothing was saved; try again.'
            : error instanceof Error
              ? error.message
              : 'Nothing was saved. Try again.',
        )
    }
    setBusy(false)
  }
  return { busy, problem, fields, run }
}
