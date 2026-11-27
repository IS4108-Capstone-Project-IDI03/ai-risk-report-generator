// The Passages dialog's page range (IN-17): From page – To page, in the dialog's header beside
// Close so the table keeps the body's room (a phone puts it on its own row under the title).
// A range that ends before it starts is marked under the pair. Used by PassagesDialog.tsx.
import { useId } from 'react'
import { Input } from '../../../design-system'
import type { Filters } from '../passageText'

/** Returns the two page fields and, for a reversed range, its error line. */
export function PassageRange({
  filters,
  reversed,
  onChange,
}: {
  filters: Filters
  reversed: boolean
  onChange: (filters: Filters) => void
}) {
  const errorId = useId()
  return (
    <div className="kb-prange-box">
      <div className="kb-prange">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="From page"
          placeholder="From page"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
        <span aria-hidden="true">–</span>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="To page"
          placeholder="To page"
          value={filters.to}
          // The error sits under both fields, not squeezed under this narrow one.
          aria-invalid={reversed}
          aria-describedby={reversed ? errorId : undefined}
          style={reversed ? { borderColor: 'var(--action-danger)' } : undefined}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </div>
      {reversed && (
        <p id={errorId} className="kb-prange-error">
          The range ends before it starts.
        </p>
      )}
    </div>
  )
}
