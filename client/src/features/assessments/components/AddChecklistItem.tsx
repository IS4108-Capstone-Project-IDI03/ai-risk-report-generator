// "Add item" at the end of the checklist (CP-37): a question and a section, existing or new.
// Called by ChecklistItems. Posts through addChecklistItem; the gateway puts it at the end.
import { useState } from 'react'
import { Button, Icon, Input, Select } from '../../../design-system'
import { GatewayError, addChecklistItem, type ChecklistView } from '../api'
import '../checklist.css'

const NEW = '__new__'

/** Returns the Add item button, or its inline form once opened. */
export function AddChecklistItem({
  reference,
  sections,
  onAdded,
}: {
  reference: string
  // The sections the checklist has: area id and title.
  sections: { id: string; title: string }[]
  onAdded: (view: ChecklistView) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [area, setArea] = useState(sections[0]?.id ?? NEW)
  const [newSection, setNewSection] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open)
    return (
      <button type="button" className="cl-add-btn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        Add item
      </button>
    )
  const creating = area === NEW
  const submit = async () => {
    const question = text.trim()
    if (!question) return setError('Write the question.')
    if (creating && !newSection.trim()) return setError('Name the new section.')
    setSaving(true)
    setError(null)
    try {
      const body = creating
        ? { text: question, newSection: newSection.trim() }
        : { text: question, area }
      onAdded(await addChecklistItem(reference, body))
      setText('')
      setNewSection('')
      setOpen(false)
    } catch (failed: unknown) {
      setError(failed instanceof GatewayError ? failed.message : 'The item could not be added.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      className="cl-add-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Input label="Question" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <Select
        label="Section"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        options={[
          ...sections.map((s) => ({ value: s.id, label: s.title })),
          { value: NEW, label: 'New section...' },
        ]}
      />
      {creating && (
        <Input
          label="New section name"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
        />
      )}
      {error && (
        <p role="alert" className="cl-note cl-error">
          {error}
        </p>
      )}
      <div className="cl-actions">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          Add
        </Button>
        <Button variant="link" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
