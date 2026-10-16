// The explanation shown instead of the delete confirmation when a report cites
// the document (IN-12): it can only be withdrawn. Withdraw instead hands over to
// the Withdraw confirmation. Opened by screens/KnowledgeDocuments.tsx.
import { Button, Dialog } from '../../../design-system'
import type { KnowledgeDocument } from '../api'

/** Returns the "Can't delete" dialog for a cited document. */
export function CitedDeleteDialog({
  document: d,
  onClose,
  onWithdraw,
}: {
  document: KnowledgeDocument
  onClose: () => void
  onWithdraw: () => void
}) {
  return (
    <Dialog
      title={`Can't delete ${d.title}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!d.withdrawn && (
            <Button variant="danger-tonal" onClick={onWithdraw}>
              Withdraw instead
            </Button>
          )}
        </>
      }
    >
      <p>
        A report cites this document, so it can&apos;t be deleted.{' '}
        {d.withdrawn ? 'It is already withdrawn.' : 'Withdraw it instead to take it out of use.'}
      </p>
    </Dialog>
  )
}
