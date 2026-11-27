// Where a typed note is written (CP-22 round 1, v2 in CP-24): a text box and "Add note". Works
// before, during, between and after recordings (it is numbered after the one running).
// Used by screens/Recording.tsx. With the assessment's `reference` the note can be
// dictated into (CP-27); the screen leaves it out while the walk itself is recording.
import { useId } from 'react'
import { Button, Panel, Textarea } from '../../../design-system'
import { DictateButton } from '../../assessments/dictation/DictateButton'
export function NoteComposer({
  value,
  onChange,
  onAdd,
  reference,
}: {
  value: string
  onChange: (text: string) => void
  onAdd: () => void
  reference?: string
}) {
  const id = useId()
  return (
    <Panel className="sw-composer" title="Notes" data-walk="site-walk.notes">
      <Textarea
        id={id}
        aria-label="Add a note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Says where to stand, then what to see: the one hint the box needs.
        placeholder="Block A, Level 1, loading bay. Pallets stored in the fire lane…"
        rows={3}
      />
      <div className="sw-composer-row">
        {reference && (
          <DictateButton
            reference={reference}
            field={() => document.getElementById(id) as HTMLTextAreaElement | null}
            onChange={onChange}
          />
        )}
        <Button variant="pill" disabled={!value.trim()} onClick={onAdd}>
          Add note
        </Button>
      </div>
    </Panel>
  )
}
