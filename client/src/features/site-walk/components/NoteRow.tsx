// One typed note in the walk list (CP-22 round 1): the text, cut short until
// opened, with edit and a red remove bin (Undo is in useWalkRemovals). A note typed before notes existed is read only.
// Used by components/WalkList.tsx.
import { useState } from 'react'
import { Icon } from '../../../design-system'

const LONG = 140

// Shows a typed note with edit and remove actions when it is editable.
export function NoteRow({
  text,
  legacy,
  onSave,
  onRemove,
}: {
  text: string
  legacy?: boolean
  // Saves new text; blank removes the note. Says whether it worked.
  onSave: (text: string) => Promise<boolean>
  // Hides the note with an Undo toast, then removes it.
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const long = text.length > LONG

  if (draft !== null)
    return (
      <li className="sw-item sw-item--editing">
        <textarea
          aria-label="Edit note"
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="sw-item-actions">
          <button type="button" className="sw-button" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="sw-button sw-button--primary"
            disabled={!draft.trim()}
            onClick={async () => {
              if (await onSave(draft)) setDraft(null)
            }}
          >
            Save note
          </button>
        </div>
      </li>
    )

  return (
    <li className="sw-item">
      <span className="sw-item-icon" aria-hidden="true">
        <Icon name="sticky-note" size={18} />
      </span>
      <div className="sw-item-main">
        <p className={'sw-note-text' + (open ? '' : ' sw-note-text--short')}>{text}</p>
        {long && (
          <button
            type="button"
            className="sw-more"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      {!legacy && (
        <div className="sw-item-tools">
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label="Edit note"
            onClick={() => setDraft(text)}
          >
            <Icon name="pencil" size={18} />
          </button>
          <button
            type="button"
            className="sw-button sw-icon-button sw-button--danger"
            aria-label="Remove note"
            title="Remove note"
            onClick={onRemove}
          >
            <Icon name="trash-2" size={18} />
          </button>
        </div>
      )}
    </li>
  )
}
