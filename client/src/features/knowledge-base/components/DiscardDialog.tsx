// The confirmation before a decision deletes a document (IN-07): Delete this
// document removes this one, Delete stored document removes the other.
// A refusal (409) shows the server's reason and keeps the dialog open. Opened
// by components/DecisionPanel.tsx.
import { Button, Callout, Dialog } from '../../../design-system'

/** Returns the confirmation for a decision that deletes `title`. */
export function DiscardDialog({
  title,
  confirmLabel,
  busy,
  problem,
  onConfirm,
  onClose,
}: {
  // The document that will be deleted.
  title: string
  // The chosen decision's name, which is also the confirm button.
  confirmLabel: string
  busy: boolean
  problem: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      title={`Delete ${title}?`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {problem && (
        <div role="alert">
          <Callout tone="warning" title="Nothing was deleted">
            {problem}
          </Callout>
        </div>
      )}
      <p>
        {title}, its file and its passages will be deleted from the knowledge base. This cannot be
        undone.
      </p>
    </Dialog>
  )
}
