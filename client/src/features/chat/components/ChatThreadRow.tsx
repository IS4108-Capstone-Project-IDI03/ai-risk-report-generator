// One saved chat in the sidebar list (CB-03): open it, rename it or delete it.
// Used by ChatThreadList. OpenUI's own row deletes at once and cannot rename, so this replaces it.
import { useThreadList } from '@openuidev/react-headless'
import { useState } from 'react'
import { IconButton } from '../../../design-system'
import { DeleteChatDialog } from './DeleteChatDialog'
import { RenameChatDialog } from './RenameChatDialog'

type Props = { id: string; title: string }

/** A chat row: the title opens the chat; the pencil and bin open the rename and delete dialogs. */
export function ChatThreadRow({ id, title }: Props) {
  const selected = useThreadList((s) => s.selectedThreadId === id)
  const select = useThreadList((s) => s.selectThread)
  const update = useThreadList((s) => s.updateThread)
  const remove = useThreadList((s) => s.deleteThread)
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const close = () => setDialog(null)
  return (
    <div className="chat-thread-row" data-selected={selected ? '' : undefined}>
      <button
        type="button"
        className="chat-thread-title"
        aria-current={selected ? 'true' : undefined}
        // A long name is cut short with an ellipsis; this shows it in full on hover.
        title={title}
        onClick={() => select(id)}
      >
        {title}
      </button>
      <span className="chat-thread-actions">
        <IconButton
          icon="pencil"
          size="sm"
          label={`Rename ${title}`}
          onClick={() => setDialog('rename')}
        />
        <IconButton
          icon="trash-2"
          size="sm"
          label={`Delete ${title}`}
          onClick={() => setDialog('delete')}
        />
      </span>
      {dialog === 'rename' && (
        <RenameChatDialog
          title={title}
          onClose={close}
          onSave={(name) => {
            update({ id, title: name, createdAt: 0 })
            close()
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteChatDialog
          title={title}
          onClose={close}
          onConfirm={() => {
            remove(id)
            close()
          }}
        />
      )}
    </div>
  )
}
