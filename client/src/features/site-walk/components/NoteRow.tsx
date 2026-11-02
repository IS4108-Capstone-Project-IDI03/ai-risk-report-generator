// One typed note in the walk list (CP-22 round 1): the text, cut short until
// opened, with edit and remove. A note typed before notes existed is read only.
// Used by components/WalkList.tsx.
import { useState } from 'react'
import { Icon } from '../../../design-system'

const LONG = 140

// Shows a typed note with edit and remove actions when it is editable.
export function NoteRow({
  text,
  legacy,
  onSave,
}: {
  text: string
  legacy?: boolean
  // Saves new text; blank removes the note. Says whether it worked.
  onSave: (text: string) => Promise<boolean>
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
            className="sw-button sw-icon-button"
            aria-label="Remove note"
            onClick={() => void onSave('')}
          >
            <Icon name="trash-2" size={18} />
          </button>
        </div>
      )}
    </li>
  )
}
