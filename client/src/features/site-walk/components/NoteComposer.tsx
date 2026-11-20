// Where a typed note is written (CP-22 round 1, v2 in CP-24): a text box and "Add note". Works
// before, during, between and after recordings (it is numbered after the one running).
// Used by screens/Recording.tsx.
import { Button, Icon } from '../../../design-system'
export function NoteComposer({
  value,
  onChange,
  onAdd,
}: {
  value: string
  onChange: (text: string) => void
  onAdd: () => void
}) {
  return (
    <section className="sw-composer">
      <h2>
        <Icon name="sticky-note" size={15} />
        Notes
      </h2>
      <textarea
        aria-label="Add a note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Block A, Level 1, loading bay. Pallets stored in the fire lane…"
        rows={3}
      />
      <div className="sw-composer-row">
        <p className="sw-note">{'Say where you are, then what you see there.'}</p>
        <Button variant="pill" disabled={!value.trim()} onClick={onAdd}>
          Add note
        </Button>
      </div>
    </section>
  )
}
