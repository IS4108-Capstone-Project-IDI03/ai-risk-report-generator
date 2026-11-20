// Where a typed note is written (CP-22 round 1, v2 in CP-24): a text box and "Add note". Works
// before, during, between and after recordings (it is numbered after the one running).
// Used by screens/Recording.tsx. With the assessment's `reference` the note can be
// dictated into (CP-27); the screen leaves it out while the walk itself is recording.
import { useRef } from 'react'
import { Button, Icon } from '../../../design-system'
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
  const box = useRef<HTMLTextAreaElement>(null)
  return (
    <section className="sw-composer">
      <h2>
        <Icon name="sticky-note" size={15} />
        Notes
      </h2>
      <textarea
        ref={box}
        aria-label="Add a note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Block A, Level 1, loading bay. Pallets stored in the fire lane…"
        rows={3}
      />
      <div className="sw-composer-row">
        <p className="sw-note">{'Say where you are, then what you see there.'}</p>
        {reference && (
          <DictateButton reference={reference} field={() => box.current} onChange={onChange} />
        )}
        <Button variant="pill" disabled={!value.trim()} onClick={onAdd}>
          Add note
        </Button>
      </div>
    </section>
  )
}
