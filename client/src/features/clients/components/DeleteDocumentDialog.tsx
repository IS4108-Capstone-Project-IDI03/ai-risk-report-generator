// Confirms deleting a client document (CP-23 AC14): the file is removed for
// good. Called by screens/DocumentsTab. Calls the delete passed in; a refusal
// stays in the dialog with its reason.
import { Button, Dialog } from '../../../design-system'
import { Problem } from '../ClientDialogs'
import { useDialogSave } from '../useDialogSave'
import type { ClientDocument } from '../api'

export function DeleteDocumentDialog({
  doc,
  remove,
  onClose,
}: {
  doc: ClientDocument
  remove: (id: string) => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useDialogSave()
  const confirm = () =>
    run(async () => {
      await remove(doc.id)
      onClose()
    })
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Delete ${doc.name}?`}
      description="The file is permanently removed from this client's documents."
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" loading={busy} onClick={confirm}>
            {'Delete'}
          </Button>
        </>
      }
    >
      <Problem title="File not deleted" problem={problem} />
    </Dialog>
  )
}
