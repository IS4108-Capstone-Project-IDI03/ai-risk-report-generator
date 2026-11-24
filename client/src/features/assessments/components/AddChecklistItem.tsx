// "Add item" at the end of the checklist (CP-37): a question and a section, existing or new.
// The section is a quiet dropdown (the PickList look), last section by default. Called by ChecklistItems. Posts through addChecklistItem; the gateway puts it at the end.
import { useEffect, useRef, useState } from 'react'
import { Button, Icon, Input, Popover } from '../../../design-system'
import { GatewayError, addChecklistItem, type ChecklistView } from '../api'
import { WORDS_MAX, WORDS_MESSAGE, WORDS_TARGET, wordCount } from '../checklistChecks'
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
  const [area, setArea] = useState(sections[sections.length - 1]?.id ?? NEW)
  const [newSection, setNewSection] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  // After an add the form closes; focus goes back to the button (preventScroll: no page jump).
  const addBtn = useRef<HTMLButtonElement>(null)
  const added = useRef(false)
  useEffect(() => {
    if (!open && added.current) {
      added.current = false
      addBtn.current?.focus({ preventScroll: true })
    }
  }, [open])
  if (!open)
    return (
      <button ref={addBtn} type="button" className="cl-add-btn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        Add item
      </button>
    )
  const creating = area === NEW
  const words = wordCount(text)
  const chosen = creating ? '+ New section' : (sections.find((x) => x.id === area)?.title ?? '')
  const choose = (id: string) => {
    setArea(id)
    setMenu(false)
    setError(null)
  }
  const submit = async () => {
    const question = text.trim()
    if (!question) return setError('Write the question.')
    if (wordCount(question) > WORDS_MAX) return setError(WORDS_MESSAGE)
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
      added.current = true
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
      <p className={'cl-count-words' + (words > WORDS_MAX ? ' cl-error' : '')} aria-live="off">
        {words} / {WORDS_TARGET} words
      </p>
      <span className="cl-field-label" id="cl-add-section">
        Section
      </span>
      <Popover
        open={menu}
        onOpenChange={setMenu}
        ariaLabel="Section"
        align="left"
        surfaceClassName="cl-pick-pop cl-section-pop"
        trigger={
          <button
            type="button"
            className="cl-pick-btn cl-section-btn"
            aria-labelledby="cl-add-section"
            aria-haspopup="listbox"
            aria-expanded={menu}
            title={chosen}
            onClick={() => setMenu(!menu)}
          >
            <span>{chosen}</span>
            <Icon name="chevron-down" size={14} />
          </button>
        }
      >
        <ul className="cl-pick-opts" role="listbox" aria-label="Section">
          {[
            ...sections.map((x) => ({ id: x.id, label: x.title })),
            { id: NEW, label: '+ New section' },
          ].map((o) => (
            <li key={o.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.id === area}
                className="cl-section-opt"
                onClick={() => choose(o.id)}
              >
                {o.label}
                {o.id === area && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
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
