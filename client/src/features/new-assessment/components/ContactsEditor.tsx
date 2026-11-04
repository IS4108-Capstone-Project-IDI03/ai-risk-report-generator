// An assessment's site contacts as a grid of cells (CP-23 AC5, boards 08, 09):
// each an initials avatar, the name and role, and a remove ×; a dashed
// "Add contact" cell opens a cell to type into. A cell is edited in place and
// shows as text once focus leaves it. Used by AssessmentBlock.tsx.
import { useState, type FocusEvent } from 'react'
import { Icon, IconButton } from '../../../design-system'
import { initials } from '../../clients/components/ClientAvatar'
import type { Contact } from '../form'

export function ContactsEditor({
  contacts,
  onChange,
}: {
  contacts: Contact[]
  onChange: (contacts: Contact[]) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const set = (k: number, patch: Partial<Contact>) =>
    onChange(contacts.map((c, i) => (i === k ? { ...c, ...patch } : c)))
  // Leaving a cell shows it as text; a cell left without a name goes.
  const leave = (k: number) => (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setEditing(null)
    if (!contacts[k]?.name.trim()) onChange(contacts.filter((_, i) => i !== k))
  }
  return (
    <fieldset className="na-contacts">
      <legend className="na-label">{'Site contacts'}</legend>
      <div className="na-contact-grid">
        {contacts.map((c, k) =>
          editing === k ? (
            <div key={k} className="na-contact is-editing" onBlur={leave(k)}>
              <input
                className="na-contact-input"
                aria-label={'Contact ' + (k + 1) + ' name'}
                placeholder="Name"
                autoComplete="off"
                autoFocus
                value={c.name}
                onChange={(e) => set(k, { name: e.target.value })}
              />
              <input
                className="na-contact-input"
                aria-label={'Contact ' + (k + 1) + ' role'}
                placeholder="Role"
                autoComplete="off"
                value={c.role}
                onChange={(e) => set(k, { role: e.target.value })}
              />
            </div>
          ) : (
            <div key={k} className="na-contact ds-on-grey">
              <button
                type="button"
                className="na-contact-text"
                aria-label={'Edit contact ' + (k + 1) + ', ' + c.name}
                onClick={() => setEditing(k)}
              >
                <span className="na-avatar" aria-hidden="true">
                  {initials(c.name)}
                </span>
                <span>
                  <strong>{c.name}</strong>
                  {c.role && <small>{c.role}</small>}
                </span>
              </button>
              <IconButton
                icon="x"
                size="sm"
                label={'Remove contact ' + (k + 1)}
                onClick={() => onChange(contacts.filter((_, i) => i !== k))}
              />
            </div>
          ),
        )}
        <button
          type="button"
          className="na-contact-add"
          onClick={() => {
            onChange([...contacts, { name: '', role: '' }])
            setEditing(contacts.length)
          }}
        >
          <Icon name="plus" size={16} />
          {'Add contact'}
        </button>
      </div>
    </fieldset>
  )
}
