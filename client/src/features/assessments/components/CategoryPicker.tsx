// The COPE category choice of the capture screen (CP-02, CP-06, CP-22): four
// toggles, each with its category's icon. One finding can concern several
// sections of the report; none chosen leaves it uncategorised. Called by
// screens/SiteObservation.tsx.
import { useId } from 'react'
import { Icon } from '../../../design-system'
import { CAT_ICON, COPE_CATEGORIES, UNCATEGORISED_HINT } from '../categories'
import { CAT_TINT } from './ObservationMarks'
import '../capture.css'

export function CategoryPicker({
  cats,
  onToggle,
  legend = 'COPE categories',
  hint = UNCATEGORISED_HINT,
}: {
  cats: string[]
  onToggle: (cat: string) => void
  // The site walk proposal asks for one category and names it "Category", with no hint.
  legend?: string
  hint?: string | null
}) {
  const hintId = useId()
  return (
    <fieldset
      className="cap-field"
      aria-describedby={cats.length || !hint ? undefined : hintId}
      style={{ margin: 0, padding: 0, border: 'none' }}
    >
      <legend className="cap-label" style={{ padding: 0, marginBottom: '6px' }}>
        {legend}
      </legend>
      <div className="cap-cats">
        {COPE_CATEGORIES.map((cat) => (
          // The checkbox is the real control, drawn as this toggle (ds-choice).
          // Each in its category's colour, as the Observations tab shows it.
          <label
            key={cat}
            className="ds-choice cap-cat"
            style={{ ['--cap-tint' as string]: CAT_TINT[cat] }}
          >
            <input type="checkbox" checked={cats.includes(cat)} onChange={() => onToggle(cat)} />
            <Icon name={CAT_ICON[cat]} size={18} color={CAT_TINT[cat]} />
            {cat}
          </label>
        ))}
      </div>
      {/* Hidden, not removed, once one is chosen, so the panel keeps its height. */}
      {!!hint && (
        <span
          id={hintId}
          className="cap-hint"
          aria-hidden={cats.length ? true : undefined}
          style={cats.length ? { visibility: 'hidden' } : undefined}
        >
          {hint}
        </span>
      )}
    </fieldset>
  )
}
