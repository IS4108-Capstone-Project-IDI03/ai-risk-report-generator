// One proposed observation in the list (CP-22 round 1, round 3, round 5; flags in CP-24): the
// Observations tab's row (assessments/components/ObservationRow.tsx), same columns and marks.
// A row still missing something is the red flagged row (reason under the note, red mark); else
// one whose category or severity the AI was not sure of is the amber one ("Check severity",
// amber mark): red is louder, so it wins. A complete one has the green tick. Pressing it opens
// the observation's page. A deleted one offers Restore in the row itself, as on the tab.
// Used by ProposalList.tsx.
import { KindBadges } from '../../assessments/components/KindBadges'
import { Icon, RowMark } from '../../../design-system'
import { CategoryMark, SeverityMark } from '../../assessments/components/ObservationMarks'
import type { ProposedObservation } from '../api'
import { isNotSure, missingFields, notSureReason } from '../proposal'

// "Needs location, severity".
const needsLabel = (fields: string[]) => 'Needs ' + fields.join(', ')

export function ProposalRow({
  o,
  onOpen,
  onRestore,
  first = false,
  flagged = false,
}: {
  o: ProposedObservation
  onOpen: () => void
  onRestore?: () => void
  // The list's first row, which the "Review a site walk" walkthrough points at (F-12).
  first?: boolean
  // The first red-marked row after the first: the walkthrough lights it as well.
  flagged?: boolean
}) {
  const missing = missingFields(o)
  // a. Which look it wears: red when something is missing, else amber when not sure.
  const unsure = !missing.length && isNotSure(o)
  const reason = missing.length ? needsLabel(missing) : unsure ? notSureReason(o) : null
  const status = missing.length ? reason! : unsure ? 'To check' : 'Ready'
  const row = (
    <button type="button" className="ob-row" onClick={onOpen}>
      <CategoryMark cats={o.copeDimension ? [o.copeDimension] : []} />
      <span className="ob-row-main">
        <span className="ob-row-text">{o.note.trim()}</span>
        <KindBadges kinds={o.kinds} />
        {reason && !onRestore && <span className="ob-row-reason">{reason}</span>}
      </span>
      <span className="ob-row-cat">{o.copeDimension ?? <span className="ob-none">—</span>}</span>
      {o.severity ? (
        <SeverityMark sev={o.severity} />
      ) : (
        <span className="ob-sev ob-none" role="img" aria-label="No severity">
          —
        </span>
      )}
      {!onRestore && (
        <span className="ob-status" title={status}>
          <RowMark kind={missing.length ? 'failed' : unsure ? 'unsure' : 'done'} label={status} />
        </span>
      )}
    </button>
  )
  if (!onRestore) {
    // The same wrapper and tints as the Observations tab's rows (assessments/observations.css).
    const tint = missing.length ? 'failed' : unsure ? 'unsure' : undefined
    return (
      <div
        className="ob-row-wrap"
        data-tint={tint}
        data-walk={first ? 'site-walk.row-1' : flagged ? 'site-walk.row-red' : undefined}
      >
        {row}
      </div>
    )
  }
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
