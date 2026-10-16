// The confirmation before a document is deleted for good (IN-12): the admin
// types its title first. A refusal (a report cites it, still being ingested)
// shows the server's reason and keeps the dialog open. Opened by
// screens/KnowledgeDocuments.tsx; calls api.ts.
import { useEffect, useRef, useState } from 'react'
import { Button, Callout, Dialog, Input } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { deleteKnowledgeDocument, type KnowledgeDocument } from '../api'

/** Returns the delete confirmation for one document. */
export function DeleteDocumentDialog({
  document: d,
  onClose,
  onDeleted,
}: {
  document: KnowledgeDocument
  onClose: () => void
  onDeleted: (deleted: KnowledgeDocument) => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)

  // Focus starts on Cancel, so Enter can't delete by accident. This runs after
  // the dialog opens, which would otherwise focus its Close button.
  useEffect(() => {
    body.current?.closest('dialog')?.querySelector<HTMLElement>('footer button')?.focus()
  }, [])

  const confirm = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await deleteKnowledgeDocument(d.id)
      onDeleted(d)
    } catch (error: unknown) {
      setProblem(
        error instanceof GatewayError && error.status === null
          ? 'The gateway could not be reached, so nothing was deleted. Try again.'
          : error instanceof Error
            ? error.message
            : 'Nothing was deleted. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Delete ${d.title}?`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={typed.trim() !== d.title.trim()}
            onClick={confirm}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <div ref={body} className="kb-delete-body">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Nothing was deleted">
              {problem}
            </Callout>
          </div>
        )}
        <p>
          This permanently deletes the file and its passages. It can&apos;t be undone. Type the
          document&apos;s title to confirm.
        </p>
        <Input label="Document title" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
    </Dialog>
  )
}
