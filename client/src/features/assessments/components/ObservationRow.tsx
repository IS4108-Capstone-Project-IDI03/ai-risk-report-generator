// One observation in the Observations tab's list (CP-22): its category icon,
// its text, category, severity symbol and status icon. Pressing it opens the
// observation's own page. A deleted one offers Restore in the row itself.
// Rendered by components/ObservationList.tsx.
import { Icon } from '../../../design-system'
import type { ObservationRowView } from '../useObservationsView'
import { ObservationBadge } from './ObservationBadge'
import { CategoryMark, SeverityMark, StatusMark } from './ObservationMarks'

export function ObservationRow({ o, onOpen }: { o: ObservationRowView; onOpen: () => void }) {
  const row = (
    <button
      type="button"
      className="ob-row"
      data-new={o.isNew || undefined}
      data-landing={o.isNew || undefined}
      onClick={onOpen}
    >
      <CategoryMark cats={o.cats} />
      <span className="ob-row-text">
        {o.isNew && <span className="ob-sr">{'New. '}</span>}
        {/* Saved from a site walk proposal (CP-22 round 3), as a badge (round 6). */}
        {o.fromSiteWalk && <ObservationBadge kind="walk" />}
        {o.text}
      </span>
      {/* One category per line, so several never run past the column. */}
      <span className="ob-row-cat">
        {o.cats.length ? o.cats.map((c) => <span key={c}>{c}</span>) : o.catLabel}
      </span>
      <SeverityMark sev={o.sev} />
      {!o.canRestore && <StatusMark status={o.status} />}
    </button>
  )
  if (!o.canRestore) return row
  // Restore beside the row, outside its button, and plain to see.
  return (
    <div className="ob-deleted">
      {row}
      <button
        type="button"
        className="ob-button ob-button--tinted ob-button--small"
        aria-label={'Restore ' + o.text.slice(0, 40)}
        onClick={o.restoreObs}
      >
        <Icon name="rotate-ccw" size={14} />
        {'Restore'}
      </button>
    </div>
  )
}
