// The dialog for renaming a saved chat (CB-03 AC4). Opened by ChatThreadRow.
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Input } from '../../../design-system'

type Props = { title: string; onSave: (title: string) => void; onClose: () => void }

/** Asks for a new name; Save is off while the name is empty. */
export function RenameChatDialog({ title, onSave, onClose }: Props) {
  const [name, setName] = useState(title)
  // A native dialog focuses its first control (the Close button) when it opens, so the name box
  // is focused one tick later, once that has happened; without this the engineer must click it.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => box.current?.querySelector('input')?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
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
      <div ref={box}>
        <Input
          label="Chat name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        />
      </div>
    </Dialog>
  )
}
