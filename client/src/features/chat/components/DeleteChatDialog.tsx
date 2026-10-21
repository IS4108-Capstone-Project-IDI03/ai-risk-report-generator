// The confirmation before a saved chat is deleted for good (CB-03 AC5). Opened by ChatThreadRow.
import { Button, Dialog } from '../../../design-system'

type Props = { title: string; onConfirm: () => void; onClose: () => void }

/** Says the delete is permanent; nothing is deleted until the engineer confirms. */
export function DeleteChatDialog({ title, onConfirm, onClose }: Props) {
  return (
    <Dialog
      title="Delete this chat?"
      description={`“${title}” and all its messages will be deleted for good. This can't be undone.`}
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete chat
          </Button>
        </>
      }
    />
  )
}
