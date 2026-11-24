// The Observations tab's list (CP-22): the observations under the place picked
// in the navigator, under a small heading per location, or the deleted ones,
// newest first. Rendered by screens/Observations.tsx.
import { EmptyState, IconRegistry } from '../../../design-system'
import { Tip } from '../../help/Tip'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import type { useObservationsView } from '../useObservationsView'
import { LocationPath } from './LocationPath'
import { ObservationRow } from './ObservationRow'

type View = ReturnType<typeof useObservationsView>

// Returns the column heads and rows, or what to do when there are none.
export function ObservationList({ v, view }: { v: AssessmentWorkflow; view: View }) {
  const open = (key: string) => () => v.openObs(key)
  if (v.obsShowDeleted)
    return v.obsList.length ? (
      <>
        <ColumnHeads last="" />
        {v.obsList.map((o) => (
          <ObservationRow key={o.key} o={o} words={v.obsSearchWords} onOpen={open(o.key)} />
        ))}
      </>
    ) : (
      <div className="ob-empty">
        <EmptyState
          icon={IconRegistry.action.discard}
          title="No deleted observations"
          description="An observation you delete is kept here, where you can restore it."
        />
      </div>
    )
  if (v.obsNoMatch) {
    // A search says what it looked for (CP-13). As on All Photos, Pages and
    // Recordings: Clear all while a filter is set, else Clear search.
    const query = v.obsFilters.q.trim()
    const filtered = v.obsFilterChips.length > 0
    return (
      <div className="ob-empty">
        <EmptyState
          icon={filtered ? IconRegistry.action.filter : 'search'}
          title={
            query
              ? `No observations match “${query}”${filtered ? ' and those filters' : ''}`
              : 'No observations match those filters'
          }
          description={
            filtered
              ? 'Clear a filter to see the others.'
              : 'Try fewer words, or check the spelling.'
          }
          action={
            <button
              type="button"
              className="ob-button ob-button--tinted ob-button--small"
              onClick={() => (filtered ? v.clearObsFilters() : v.setObsFilter('q', ''))}
            >
              {filtered ? 'Clear all' : 'Clear search'}
            </button>
          }
        />
      </div>
    )
  }
  if (!view.sections.some((s) => s.location.items.length))
    return (
      <div className="ob-empty">
        <EmptyState
          icon="camera"
          title={view.location ? 'Nothing recorded here yet' : 'No observations yet'}
          description="Add one manually, or record a site walk to add several at once."
        />
      </div>
    )
  // One location picked: its rows need no heading.
  const headed = !view.location
  // F-12: the first row, and the first one waiting on the engineer (amber), carry the walkthrough's tags.
  const rows = view.sections.flatMap((s) => s.location.items)
  const first = rows[0]
  const toCheck = rows.find((o) => o.tint === 'unsure')
  // And the first one that came from a site walk: "Review a site walk" ends on it.
  const fromWalk = rows.find((o) => o.fromSiteWalk)
  return (
    <>
      <ColumnHeads walk statusTip />
      {view.sections.map(({ location: l, path }) => (
        <section key={l.id} aria-label={l.label}>
          {headed && (
            <h3 className="ob-group-head">{path.bare ? l.name : <LocationPath {...path} />}</h3>
          )}
          {l.items.map((o) => (
            <ObservationRow
              key={o.key}
              o={o}
              words={v.obsSearchWords}
              onOpen={open(o.key)}
              first={o === first}
              toCheck={o === toCheck}
              fromWalk={o === fromWalk}
            />
          ))}
        </section>
      ))}
    </>
  )
}

// The deleted list has Restore, not a status, in the last column. Sentence case.
// Also heads a site walk proposal's table (site-walk/components/ProposalList.tsx).
// `walk` tags the headings for the Observations walkthrough (F-12); `statusTip` puts the Status
// help tip (F-13) beside the heading. A tip is a button, so the row is no longer hidden whole: each
// word is.
export function ColumnHeads({
  last = 'Status',
  walk = false,
  statusTip = false,
}: {
  last?: string
  // true tags the heads for the Observations walkthrough; a string is the tag to use instead (F-12).
  walk?: boolean | string
  statusTip?: boolean
}) {
  const hidden = statusTip ? undefined : true
  const word = statusTip ? ({ 'aria-hidden': true } as const) : {}
  return (
    <div
      className="ob-colhead"
      aria-hidden={hidden}
      data-walk={typeof walk === 'string' ? walk : walk ? 'observations.head' : undefined}
    >
      <span />
      <span {...word}>{'Observation'}</span>
      <span {...word}>{'Category'}</span>
      <span {...word}>{'Severity'}</span>
      <span className="ob-colhead-last">
        <span {...word}>{last}</span>
        {statusTip && <Tip id="observations.status" align="right" />}
      </span>
    </div>
  )
}
