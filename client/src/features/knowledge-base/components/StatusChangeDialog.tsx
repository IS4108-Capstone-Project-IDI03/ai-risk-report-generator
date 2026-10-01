// The Withdraw or Reinstate confirmation (KB-02 AC1, AC5): says what the change
// does for new reports. An active document gets Withdraw, a withdrawn one
// Reinstate. A failure shows why and keeps the dialog open. Opened by
// screens/KnowledgeDocuments.tsx; calls api.ts.
import { useState } from 'react'
import { Button, Callout, Dialog } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { reinstateDocument, withdrawDocument, type KnowledgeDocument } from '../api'

const WITHDRAW = {
  verb: 'Withdraw',
  variant: 'danger',
  change: withdrawDocument,
  failed: "Couldn't withdraw this document",
  explain:
    'New reports will stop using this document. It stays in the knowledge base, and you can reinstate it at any time.',
}
const REINSTATE = {
  verb: 'Reinstate',
  variant: 'primary',
  change: reinstateDocument,
  failed: "Couldn't reinstate this document",
  explain: 'New reports will use this document again. You can withdraw it again at any time.',
}

/** Returns the Withdraw or Reinstate confirmation for one document. */
export function StatusChangeDialog({
  document: d,
  onClose,
  onChanged,
}: {
  document: KnowledgeDocument
  onClose: () => void
  onChanged: (updated: KnowledgeDocument) => void
}) {
  const action = d.withdrawn ? REINSTATE : WITHDRAW
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setProblem(null)
    try {
      onChanged(await action.change(d.id))
    } catch (error: unknown) {
      // The server's reason says why; a missing gateway has no reason to give.
      setProblem(
        error instanceof GatewayError && error.status === null
          ? 'The gateway could not be reached, so nothing changed. Try again.'
          : error instanceof Error
            ? error.message
            : 'Nothing changed. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`${action.verb} ${d.title}?`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action.variant} loading={busy} onClick={confirm}>
            {action.verb}
          </Button>
        </>
      }
    >
      {problem && (
        <div role="alert">
          <Callout tone="warning" title={action.failed}>
            {problem}
          </Callout>
        </div>
      )}
      <p>{action.explain}</p>
    </Dialog>
  )
}
