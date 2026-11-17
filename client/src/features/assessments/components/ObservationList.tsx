// The Observations tab's list (CP-22): the observations under the place picked
// in the navigator, under a small heading per location, or the deleted ones,
// newest first. Rendered by screens/Observations.tsx.
import { EmptyState, IconRegistry } from '../../../design-system'
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
          description="Record a site walk, or add observations one at a time."
        />
      </div>
    )
  // One location picked: its rows need no heading.
  const headed = !view.location
  return (
    <>
      <ColumnHeads />
      {view.sections.map(({ location: l, path }) => (
        <section key={l.id} aria-label={l.label}>
          {headed && (
            <h3 className="ob-group-head">{path.bare ? l.name : <LocationPath {...path} />}</h3>
          )}
          {l.items.map((o) => (
            <ObservationRow key={o.key} o={o} words={v.obsSearchWords} onOpen={open(o.key)} />
          ))}
        </section>
      ))}
    </>
  )
}

// The deleted list has Restore, not a status, in the last column. Sentence case.
// Also heads a site walk proposal's table (site-walk/components/ProposalList.tsx).
export function ColumnHeads({ last = 'Status' }: { last?: string }) {
  return (
    <div className="ob-colhead" aria-hidden="true">
      <span />
      <span>{'Observation'}</span>
      <span>{'Category'}</span>
      <span>{'Severity'}</span>
      <span>{last}</span>
    </div>
  )
}
