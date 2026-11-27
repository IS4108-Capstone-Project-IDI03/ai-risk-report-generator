// One saved chat in the sidebar list (CB-03): open it, rename it or delete it.
// Used by ChatThreadList. OpenUI's own row deletes at once and cannot rename, so this replaces it.
import { useThreadList } from '@openuidev/react-headless'
import { useState } from 'react'
import { IconAction } from '../../../design-system'
import { DeleteChatDialog } from './DeleteChatDialog'
import { RenameChatDialog } from './RenameChatDialog'
import { closeChatsDrawer } from '../chatsDrawer'

// `createdAt` is passed back on rename, so the renamed chat keeps its recency group.
type Props = { id: string; title: string; createdAt: string | number }

/** A chat row: the title opens the chat; the pencil and bin open the rename and delete dialogs. */
export function ChatThreadRow({ id, title, createdAt }: Props) {
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
        onClick={() => {
          select(id)
          closeChatsDrawer()
        }}
      >
        {title}
      </button>
      <span className="chat-thread-actions">
        <IconAction
          icon="pencil"
          label={`Rename ${title}`}
          tooltip="Rename chat"
          onClick={() => setDialog('rename')}
        />
        <IconAction
          icon="trash-2"
          danger
          label={`Delete ${title}`}
          tooltip="Delete chat"
          onClick={() => setDialog('delete')}
        />
      </span>
      {dialog === 'rename' && (
        <RenameChatDialog
          title={title}
          onClose={close}
          onSave={(name) => {
            update({ id, title: name, createdAt })
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
