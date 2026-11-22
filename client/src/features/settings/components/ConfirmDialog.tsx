// Asks first, then runs one action and tells the person how it went (F-12, Settings > Walkthroughs).
// Called by WalkthroughsSection and PracticeRow. Calls the `run` it is given, through attempt().
import { useState } from 'react'
import { Button, Dialog } from '../../../design-system'
import { attempt } from './attempt'

export function ConfirmDialog({
  title,
  body,
  confirm,
  danger,
  run,
  done,
  failed,
  onClose,
}: {
  title: string
  body: string
  confirm: string
  danger?: boolean
  run: () => Promise<unknown>
  done: string
  failed: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  // The dialog closes first, then the toast shows: a modal dialog covers the app's toaster.
  const go = async () => {
    setBusy(true)
    const worked = await attempt(run, done, failed)
    onClose()
    return worked
  }
  return (
    <Dialog
      className="ds-dialog--v2"
      title={title}
      description={body}
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button pill variant={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>
            {confirm}
          </Button>
        </>
      }
    />
  )
}
