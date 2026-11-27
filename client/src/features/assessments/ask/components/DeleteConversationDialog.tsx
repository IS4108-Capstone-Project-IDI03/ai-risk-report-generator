// The confirmation before an Ask conversation is deleted (AS-03 AC2), with what goes with it.
// Cancel is the safe choice and takes focus; a delete that fails keeps the dialog open with the
// reason. Opened from ConversationBar's Delete by AskPanel.tsx.
import { useEffect, useRef } from 'react'
import { Button, Callout, Dialog } from '../../../../design-system'
import { useSave } from '../../components/useSave'
import type { AskConversation } from '../api'

function deletedWhat(questions: number) {
  if (questions === 0) return 'It is deleted for good.'
  const what =
    questions === 1 ? 'Its question and answer are' : `Its ${questions} questions and answers are`
  return `${what} deleted for good and can't be opened again.`
}

/** Returns the delete dialog; `onDelete` resolves once the conversation is gone. */
export function DeleteConversationDialog({
  conversation,
  questions,
  onDelete,
  onClose,
}: {
  conversation: AskConversation
  questions: number
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useSave()
  // Focus starts on Cancel, not on the Close button a native dialog picks
  // first (as a saved chat's delete, CB-03). Set one tick after it opens.
  const buttons = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => buttons.current?.querySelector('button')?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Dialog
      title="Delete this conversation?"
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <span ref={buttons} className="ask-delete-actions">
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            pill
            variant="danger"
            iconLeft="trash-2"
            loading={busy}
            onClick={() => run(onDelete)}
          >
            Delete conversation
          </Button>
        </span>
      }
    >
      <div className="ask-delete">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Conversation not deleted">
              {problem}
            </Callout>
          </div>
        )}
        <p className="ask-delete-title">{conversation.title}</p>
        <p>{deletedWhat(questions)} Nothing in the report changes.</p>
      </div>
    </Dialog>
  )
}
