// The confirmation before a saved chat is deleted for good (CB-03 AC5). Opened by ChatThreadRow.
import { useEffect, useRef } from 'react'
import { Button, Dialog } from '../../../design-system'

type Props = { title: string; onConfirm: () => void; onClose: () => void }

/** Says the delete is permanent; nothing is deleted until the engineer confirms. */
export function DeleteChatDialog({ title, onConfirm, onClose }: Props) {
  // Focus starts on Cancel, the safe choice for a delete, not on the Close button a native
  // dialog picks first. Set one tick after the dialog opens.
  const buttons = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => buttons.current?.querySelector('button')?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Dialog
      title="Delete this chat?"
      description={`“${title}” and all its messages will be deleted for good. This can't be undone.`}
      width={400}
      onClose={onClose}
      footer={
        <span ref={buttons} className="chat-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete chat
          </Button>
        </span>
      }
    />
  )
}
