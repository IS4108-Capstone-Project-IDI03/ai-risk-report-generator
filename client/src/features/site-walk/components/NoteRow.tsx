// One typed note in the walk list (CP-22 round 1): the text, cut short until
// opened, with edit and a red remove bin (Undo is in useWalkRemovals). A note typed before notes existed is read only.
// With the assessment's `reference` the note being edited can be dictated into (CP-27).
// Used by components/WalkList.tsx.
import { useId, useState } from 'react'
import { Button, Icon, IconAction, Textarea } from '../../../design-system'
import { DictateButton } from '../../assessments/dictation/DictateButton'

const LONG = 140

// Shows a typed note with edit and remove actions when it is editable.
export function NoteRow({
  text,
  legacy,
  onSave,
  onRemove,
  reference,
}: {
  text: string
  legacy?: boolean
  // Saves new text; blank removes the note. Says whether it worked.
  onSave: (text: string) => Promise<boolean>
  // Hides the note with an Undo toast, then removes it.
  onRemove: () => void
  // Left out while the walk itself records: it already hears what is said.
  reference?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const long = text.length > LONG
  const id = useId()

  if (draft !== null)
    return (
      <li className="sw-item sw-item--editing">
        <Textarea
          id={id}
          aria-label="Edit note"
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="sw-item-actions">
          {reference && (
            <DictateButton
              reference={reference}
              field={() => document.getElementById(id) as HTMLTextAreaElement | null}
              onChange={setDraft}
            />
          )}
          <Button pill variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            pill
            variant="primary"
            disabled={!draft.trim()}
            onClick={async () => {
              if (await onSave(draft)) setDraft(null)
            }}
          >
            Save note
          </Button>
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
          <IconAction icon="pencil" label="Edit note" onClick={() => setDraft(text)} />
          <IconAction
            icon="trash-2"
            label="Remove note"
            tooltip="Remove note"
            danger
            onClick={onRemove}
          />
        </div>
      )}
    </li>
  )
}
