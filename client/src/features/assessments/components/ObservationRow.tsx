// One observation in the Observations tab's list (CP-22, CP-24): its category icon,
// its text, category, severity symbol and status mark. Pressing it opens the
// observation's own page. A deleted one offers Restore in the row itself.
// A row with something to check is tinted amber with its reason under the text, a failed
// suggestion red, a row being read blue (v2 "Flagged row"); an empty category or severity is a dash.
// While a search is on (CP-13), its words are marked in the text, and where
// else they were found is said under it: "Matched in Recording 2".
// Rendered by components/ObservationList.tsx.
import { useState } from 'react'
import { Icon } from '../../../design-system'
import { useSignalAtStep } from '../../site-walk/walkSteps'
import type { ObservationRowView } from '../useObservationsView'
import { HitText } from './HitText'
import { KindBadges } from './KindBadges'
import { ObservationBadge } from './ObservationBadge'
import { CategoryMark, SeverityMark, StatusMark } from './ObservationMarks'

export function ObservationRow({
  o,
  words = [],
  onOpen,
  first = false,
  toCheck = false,
  fromWalk = false,
}: {
  o: ObservationRowView
  words?: readonly string[]
  onOpen: () => void
  // The list's first row, and its first amber row: the Observations walkthrough points at them (F-12).
  first?: boolean
  toCheck?: boolean
  // The first row that came from a site walk: the "Review a site walk" walkthrough ends on it (F-12).
  fromWalk?: boolean
}) {
  // F-12: "Add an observation" waits for the one just saved to be written out and read: amber when
  // the AI was unsure of a value (To check), else Complete.
  const read = o.status === 'To check' || o.status === 'Complete'
  useSignalAtStep('observation-reading-finished', o.isNew && read, 'new-observation', 7)
  useSignalAtStep('try-it-failed', o.isNew && o.status.endsWith('failed'), 'new-observation', 7)
  // A reason that appears after the row was on screen fades in; one already there on load
  // does not animate (v2 motion "A row becoming flagged"). Without this the whole list
  // would animate every time the tab opened.
  const [lastReason, setLastReason] = useState(o.reason)
  const [becoming, setBecoming] = useState(false)
  if (o.reason !== lastReason) {
    setLastReason(o.reason)
    setBecoming(!lastReason && !!o.reason)
  }
  const row = (
    <button
      type="button"
      className="ob-row"
      data-new={o.isNew || undefined}
      data-landing={o.isNew || undefined}
      data-walk={
        toCheck ? 'observations.to-check' : first && fromWalk ? 'site-walk.new-row' : undefined
      }
      onClick={onOpen}
    >
      {/* The site walk mark sits outside the tile's corner; the tile clips its own contents. */}
      <span className="ob-cat-wrap">
        <CategoryMark cats={o.cats} />
        {o.fromSiteWalk && (
          <span className="ob-cat-flag">
            <ObservationBadge kind="walk" />
          </span>
        )}
      </span>
      <span className="ob-row-main">
        <span className="ob-row-text">
          {o.isNew && <span className="ob-sr">{'New. '}</span>}
          <HitText text={o.text} words={words} />
        </span>
        <KindBadges kinds={o.kinds} labels={o.labels} />
        {o.reason && (
          <span className="ob-row-reason" data-in={becoming || undefined}>
            {o.reason}
          </span>
        )}
        {o.matchedIn && (
          <span className="ob-row-match">
            <Icon name="search" size={12} />
            {o.matchedIn}
          </span>
        )}
      </span>
      {/* One category per line, so several never run past the column. */}
      <span className="ob-row-cat">
        {o.cats.length ? (
          o.cats.map((c) => <span key={c}>{c}</span>)
        ) : (
          <span className="ob-none">{'–'}</span>
        )}
      </span>
      <SeverityMark sev={o.sev} />
      {!o.canRestore && <StatusMark status={o.status} />}
    </button>
  )
  // The wrapper carries the tint and the hairline, so hovering the row still shades over it.
  if (!o.canRestore)
    return (
      <div
        className="ob-row-wrap"
        data-tint={o.tint ?? undefined}
        data-walk={first ? 'observations.row-1' : fromWalk ? 'site-walk.new-row' : undefined}
      >
        {row}
      </div>
    )
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
