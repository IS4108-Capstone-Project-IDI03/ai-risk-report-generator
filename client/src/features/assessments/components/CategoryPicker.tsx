import { useId } from 'react'
import { Checkbox } from '../../../design-system'
import { COPE_CATEGORIES, UNCATEGORISED_HINT } from '../categories'

// The COPE categories of an observation, any number of them (CP-02, CP-06):
// one finding can concern several sections of the report. None chosen leaves
// it uncategorised.
export function CategoryPicker({
  cats,
  onToggle,
}: {
  cats: string[]
  onToggle: (cat: string) => void
}) {
  const hintId = useId()
  return (
    <fieldset
      aria-describedby={cats.length ? undefined : hintId}
      style={{
        margin: 0,
        padding: 0,
        border: 'none',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <legend
        style={{
          padding: 0,
          marginBottom: 'var(--space-3)',
          fontSize: 'var(--text-small-size)',
          lineHeight: 'var(--text-small-lh)',
          fontWeight: 'var(--weight-medium)',
          color: 'var(--text-body)',
        }}
      >
        {'COPE categories'}
      </legend>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
          gap: 'var(--space-3) var(--space-5)',
        }}
      >
        {COPE_CATEGORIES.map((cat) => (
          <Checkbox
            key={cat}
            label={cat}
            checked={cats.includes(cat)}
            onChange={() => onToggle(cat)}
          />
        ))}
      </div>
      {!cats.length && (
        <span
          id={hintId}
          style={{ fontSize: 'var(--text-caption-size)', color: 'var(--text-muted)' }}
        >
          {UNCATEGORISED_HINT}
        </span>
      )}
    </fieldset>
  )
}
