// One proposed observation in the list (CP-22 round 1, round 3, round 5): the
// Observations tab's row (assessments/components/ObservationRow.tsx), same
// columns and marks. One still missing something says what, in red above its
// note, with a red mark in Status; a complete one has the green tick.
// Pressing it opens the observation's page. A deleted one offers Restore in
// the row itself, as on the tab. Used by ProposalList.tsx.
import { Icon } from '../../../design-system'
import { CategoryMark, SeverityMark } from '../../assessments/components/ObservationMarks'
import type { ProposedObservation } from '../api'
import { missingFields } from '../proposal'

// "Needs location, severity".
const needsLabel = (fields: string[]) => 'Needs ' + fields.join(', ')

export function ProposalRow({
  o,
  onOpen,
  onRestore,
}: {
  o: ProposedObservation
  onOpen: () => void
  onRestore?: () => void
}) {
  const missing = missingFields(o)
  const status = missing.length ? needsLabel(missing) : 'Ready'
  const row = (
    <button type="button" className="ob-row" onClick={onOpen}>
      <CategoryMark cats={o.copeDimension ? [o.copeDimension] : []} />
      <span className="ob-row-text">
        {missing.length > 0 && !onRestore && (
          <span className="ob-needs">
            <Icon name="circle-alert" size={13} />
            {needsLabel(missing)}
          </span>
        )}
        {o.note.trim()}
      </span>
      <span className="ob-row-cat">{o.copeDimension ?? <span className="ob-none">—</span>}</span>
      {o.severity ? (
        <SeverityMark sev={o.severity} />
      ) : (
        <span className="ob-sev ob-none" aria-label="No severity">
          —
        </span>
      )}
      {!onRestore && (
        <span className="ob-status" title={status}>
          <Icon
            name={missing.length ? 'circle-alert' : 'circle-check'}
            size={17}
            color={missing.length ? 'var(--red-600)' : 'var(--green-600)'}
          />
          <span className="ob-sr">{status}</span>
        </span>
      )}
    </button>
  )
  if (!onRestore) return row
  return (
    <div className="ob-deleted">
      {row}
      <button
        type="button"
        className="ob-button ob-button--tinted ob-button--small"
        aria-label={'Restore ' + o.note.slice(0, 40)}
        onClick={onRestore}
      >
        <Icon name="rotate-ccw" size={14} />
        Restore
      </button>
    </div>
  )
}
