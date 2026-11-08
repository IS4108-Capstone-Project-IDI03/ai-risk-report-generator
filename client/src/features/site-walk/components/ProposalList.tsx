// The selected location's proposed observations (CP-22 round 1, round 5) as the
// Observations tab's table: its column heads (assessments/components/ObservationList.tsx),
// then a row each, matching the filters. "All locations" groups the rows under
// each location's arrow path. Deleted ones list newest first with Restore, as
// on the tab. Used by screens/Review.tsx.
import { EmptyState, IconRegistry } from '../../../design-system'
import { LocationPath } from '../../assessments/components/LocationPath'
import { ColumnHeads } from '../../assessments/components/ObservationList'
import type { Proposal, SiteWalk } from '../api'
import { pathOf } from '../options'
import { matchesProposalFilters, sectionsAt, type ProposalFilters } from '../proposal'
import { ProposalRow } from './ProposalRow'

// Lists proposed observations grouped by their selected location.
export function ProposalList({
  proposal,
  media,
  selected,
  filters,
  onOpen,
}: {
  proposal: Proposal
  media: SiteWalk['media']
  selected: string
  filters: ProposalFilters
  onOpen: (ref: string) => void
}) {
  const all = sectionsAt(proposal, selected)
  const sections = all
    .map((s) => ({ ...s, items: s.items.filter((o) => matchesProposalFilters(o, filters, media)) }))
    .filter((s) => s.items.length)
  if (all.length && !sections.length)
    return (
      <div className="ob-empty">
        <EmptyState
          icon={IconRegistry.action.filter}
          title="No observations match those filters"
          description="Clear a filter to see the others."
        />
      </div>
    )
  if (!sections.length)
    return (
      <div className="ob-empty">
        <EmptyState
          icon="camera"
          title="No observations here"
          description="Add one here, or pick another location."
        />
      </div>
    )
  // One location picked: its rows need no heading.
  const headed = sections.length > 1 || selected === 'all'
  return (
    <>
      <ColumnHeads />
      {sections.map((s) => (
        <section key={s.ref} aria-label={s.location ? s.location.name : 'No location yet'}>
          {headed && (
            <h3 className="ob-group-head">
              {s.location ? <LocationPath {...pathOf(s.location)} /> : 'No location yet'}
            </h3>
          )}
          {s.items.map((o) => (
            <ProposalRow key={o.ref} o={o} onOpen={() => onOpen(o.ref)} />
          ))}
        </section>
      ))}
    </>
  )
}

// The proposal's deleted observations matching the filters, each with Restore.
export function DeletedProposalList({
  proposal,
  media,
  filters,
  onOpen,
  onRestore,
}: {
  proposal: Proposal
  media: SiteWalk['media']
  filters: ProposalFilters
  onOpen: (ref: string) => void
  // Left out for someone reading another engineer's walk (RV-11 AC2).
  onRestore?: (ref: string) => void
}) {
  const removed = (proposal.removed ?? []).filter((o) => matchesProposalFilters(o, filters, media))
  if (proposal.removed?.length && !removed.length)
    return (
      <div className="ob-empty">
        <EmptyState
          icon={IconRegistry.action.filter}
          title="No observations match those filters"
          description="Clear a filter to see the others."
        />
      </div>
    )
  if (!removed.length)
    return (
      <div className="ob-empty">
        <EmptyState
          icon={IconRegistry.action.discard}
          title="No deleted observations"
          description="An observation you delete is kept here, where you can restore it."
        />
      </div>
    )
  return (
    <>
      {onRestore ? <ColumnHeads last="" /> : <ColumnHeads />}
      {removed.map((o) => (
        <ProposalRow
          key={o.ref}
          o={o}
          onOpen={() => onOpen(o.ref)}
          onRestore={onRestore && (() => onRestore(o.ref))}
        />
      ))}
    </>
  )
}
