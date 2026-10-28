// One saved fact in "My preferences" (CB-05): its text, the date it was added, and Edit and
// Delete. Used by screens/Preferences.tsx.
import { useState } from 'react'
import { IconButton } from '../../../design-system'
import type { Fact } from '../api'
import { FactForm } from './FactForm'

type Props = {
  fact: Fact
  max: number
  onSave: (id: string, text: string) => Promise<void>
  onDelete: (id: string) => void
}

const added = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })

/** Shows a fact; Edit swaps it for the form, and Delete asks the screen to remove it. */
export function FactRow({ fact, max, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return (
      <li className="fact-row fact-row--editing">
        <FactForm
          initial={fact.text}
          max={max}
          label="Edit fact"
          submitLabel="Save"
          onSubmit={async (text) => {
            await onSave(fact.id, text)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    )
  return (
    <li className="fact-row">
      <div className="fact-row__text">
        <p>{fact.text}</p>
        <span className="fact-row__date">Added {added(fact.createdAt)}</span>
      </div>
      <div className="fact-row__actions">
        <IconButton icon="pencil" label={`Edit: ${fact.text}`} onClick={() => setEditing(true)} />
        <IconButton
          icon="trash-2"
          label={`Delete: ${fact.text}`}
          onClick={() => onDelete(fact.id)}
        />
      </div>
    </li>
  )
}
