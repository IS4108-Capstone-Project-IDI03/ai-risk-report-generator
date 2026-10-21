// The dialog for renaming a saved chat (CB-03 AC4). Opened by ChatThreadRow.
import { useState } from 'react'
import { Button, Dialog, Input } from '../../../design-system'

type Props = { title: string; onSave: (title: string) => void; onClose: () => void }

/** Asks for a new name; Save is off while the name is empty. */
export function RenameChatDialog({ title, onSave, onClose }: Props) {
  const [name, setName] = useState(title)
  return (
    <Dialog
      title="Rename chat"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      <Input
        label="Chat name"
        value={name}
        maxLength={100}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
      />
    </Dialog>
  )
}
