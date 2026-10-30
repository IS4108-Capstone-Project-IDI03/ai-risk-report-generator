// One saved fact in "My preferences" (CB-05): its text, the date it was added, and Edit and
// Delete. Used by components/PreferencesPanel.tsx.
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../../design-system'
import type { Fact } from '../api'
import { FactForm } from './FactForm'

type Props = {
  fact: Fact
  max: number
  onSave: (id: string, text: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const added = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })

// A long fact would make a very long button name; the first words are enough to tell them apart.
const short = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text)

/** Shows a fact; Edit swaps it for the form, and Delete asks the screen to remove it. */
export function FactRow({ fact, max, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  // When an edit ends (Save or Cancel) the box disappears; without this, keyboard focus would be
  // lost to the page. It goes back to the row's first button (Edit).
  const row = useRef<HTMLLIElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) row.current?.querySelector('button')?.focus()
    wasEditing.current = editing
  }, [editing])
  if (editing)
    return (
      <li ref={row} className="fact-row fact-row--editing">
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
    <li ref={row} className="fact-row">
      <div className="fact-row__text">
        <p>{fact.text}</p>
        <span className="fact-row__date">Added {added(fact.createdAt)}</span>
      </div>
      <div className="fact-row__actions">
        <IconButton
          icon="pencil"
          label={`Edit: ${short(fact.text)}`}
          onClick={() => setEditing(true)}
        />
        <IconButton
          icon="trash-2"
          label={`Delete: ${short(fact.text)}`}
          onClick={() => onDelete(fact.id)}
        />
      </div>
    </li>
  )
}
