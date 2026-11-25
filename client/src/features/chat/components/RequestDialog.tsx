// The dialog behind "Ask an admin to add it" (CB-07): says what the admins will get (the
// question, quoted, and an optional message), then sends the request. A v2 Dialog.
// Opened by components/DeclinedReply.tsx; calls ../api.ts.
import { useState } from 'react'
import { Button, Callout, Dialog, Textarea } from '../../../design-system'
import { askAdminToAdd } from '../api'

/** Returns the send-request dialog for one declined question. */
export function RequestDialog({
  question,
  onClose,
  onSent,
}: {
  question: string
  onClose: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await askAdminToAdd(question, message.trim())
      onSent()
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'The request was not sent. Try again.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Ask an admin to add a document"
      description="Your knowledge admins get your question and your message, so they can add the document that answers it."
      width={520}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button pill variant="primary" loading={busy} aria-busy={busy} onClick={send}>
            Send request
          </Button>
        </>
      }
    >
      <div className="chat-request-dialog">
        {problem && (
          <div role="alert">
            <Callout tone="danger">{problem}</Callout>
          </div>
        )}
        <section className="chat-dialog-field">
          <h3 className="chat-dialog-label">Your question</h3>
          <blockquote className="chat-request-question">{question}</blockquote>
        </section>
        <Textarea
          label="Message to your admins (optional)"
          rows={4}
          maxLength={1000}
          placeholder="Which document, or what detail, would help answer this?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Dialog>
  )
}
