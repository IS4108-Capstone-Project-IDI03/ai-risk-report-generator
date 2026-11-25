// One fixed checklist item in Settings > Checklist (CP-37 AC4): its wording and area, with Edit
// and Remove; or, while editing, the two fields in place with Save and Cancel (Enter saves,
// Escape cancels). Called by screens/ChecklistSection.tsx.
import { useState } from 'react'
import { Button, Input } from '../../../design-system'
import type { FixedItem } from '../api'

type Props = {
  item: FixedItem
  // Runs the change; resolves to an error message, or '' when it worked.
  onSave: (id: string, text: string, area: string) => Promise<string>
  onRemove: (item: FixedItem) => void
}

export function FixedItemRow({ item, onSave, onRemove }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [area, setArea] = useState(item.area ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!text.trim()) return setError('Write the question first.')
    setSaving(true)
    const problem = await onSave(item.id, text.trim(), area.trim())
    setSaving(false)
    setError(problem)
    if (!problem) setEditing(false)
  }
  const cancel = () => {
    setEditing(false)
    setText(item.text)
    setArea(item.area ?? '')
    setError('')
  }

  if (!editing)
    return (
      <li className="st-cl-row">
        <div className="st-cl-text">
          <span>{item.text}</span>
          {item.area && <span className="st-muted">Section {item.area}</span>}
        </div>
        <Button variant="pill" onClick={() => setEditing(true)} aria-label={`Edit ${item.text}`}>
          Edit
        </Button>
        <Button variant="pill" onClick={() => onRemove(item)} aria-label={`Remove ${item.text}`}>
          Remove
        </Button>
      </li>
    )
  return (
    <li
      className="st-cl-row st-cl-row--edit"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
        if (e.key === 'Enter' && !saving) void save()
      }}
    >
      <Input label="Question" value={text} onChange={(e) => setText(e.target.value)} />
      <Input
        label="Report section (optional)"
        value={area}
        onChange={(e) => setArea(e.target.value)}
      />
      {error && (
        <p className="st-err" role="alert">
          {error}
        </p>
      )}
      <div className="st-row-head">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="pill" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </li>
  )
}
