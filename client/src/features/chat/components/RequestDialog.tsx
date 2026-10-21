// The dialog behind "Ask an admin to add it" (CB-07): says what the admins will get (the
// question, quoted, and an optional message), then sends the request. Chat look, not the
// design system's (CLAUDE.local.md). Opened by components/DeclinedReply.tsx; calls ../api.ts.
import { useId, useState } from 'react'
import { Dialog, Icon } from '../../../design-system'
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
  const messageId = useId()

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
      className="chat-dialog ds-dialog-sheet"
      title="Ask an admin to add a document"
      description="Your knowledge admins get your question and your message, so they can add the document that answers it."
      width={520}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className="chat-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="chat-button chat-button--primary"
            disabled={busy}
            aria-busy={busy}
            onClick={send}
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </>
      }
    >
      <div className="chat-request-dialog">
        {problem && (
          <p className="chat-dialog-problem" role="alert">
            <Icon name="circle-alert" size={16} />
            {problem}
          </p>
        )}
        <section className="chat-dialog-field">
          <h3 className="chat-dialog-label">Your question</h3>
          <blockquote className="chat-request-question">{question}</blockquote>
        </section>
        <section className="chat-dialog-field">
          <label className="chat-dialog-label" htmlFor={messageId}>
            Message to your admins <span>(Optional)</span>
          </label>
          <textarea
            id={messageId}
            className="chat-dialog-textarea"
            rows={4}
            maxLength={1000}
            placeholder="Which document, or what detail, would help answer this?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </section>
      </div>
    </Dialog>
  )
}
