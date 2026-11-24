// A site walk proposal's two table cards (CP-22 round 5, v2 in CP-24), as the Observations
// tab draws them (assessments/screens/Observations.tsx): its toolbar of filter pills
// with Add observation, the place picked above the rows, the table, then its footer count
// ("6 observations · 2 to check", with what needs a location as a link); and the
// deleted list with its filters and count. Rendered by screens/Review.tsx.
import { Button, Icon, TableFooter } from '../../../design-system'
import { locationLabel } from '../../assessments/locations'
import { plural } from '../../assessments/reviewDisplay'
import type { Proposal, ProposedLocation, SiteWalk } from '../api'
import { pathOf } from '../options'
import {
  ALL,
  incompleteCount,
  incompleteWords,
  isNotSure,
  lacksValue,
  type ProposalFilters,
} from '../proposal'
import { ProposalFilterChips } from './ProposalFilters'
import { DeletedProposalList, ProposalList } from './ProposalList'

type Shared = {
  proposal: Proposal
  media: SiteWalk['media']
  filters: ProposalFilters
  onFilters: (filters: ProposalFilters) => void
  onOpen: (ref: string) => void
}

// The selected place's observations; Use an existing location is on the
// location's own row in the navigator.
export function ProposalTable({
  selected,
  location,
  title,
  onAdd,
  onFix,
  ...s
}: Shared & {
  selected: string
  location: ProposedLocation | null
  // The selected entry's name, e.g. "No location yet".
  title: string
  // Left out for someone reading another engineer's walk (RV-11 AC2).
  onAdd?: () => void
  // Opens the first observation still missing something; the footer's link.
  onFix?: () => void
}) {
  const rows = s.proposal.observations
  const toCheck = rows.filter((o) => !lacksValue(o) && isNotSure(o)).length
  return (
    <div className="ob-card">
      <div className="ob-filters">
        <div className="ob-filter-set">
          <ProposalFilterChips filters={s.filters} onChange={s.onFilters} />
        </div>
        {onAdd && (
          <div className="ob-head-actions">
            <Button variant="pill" iconLeft="plus" aria-label="Add observation" onClick={onAdd}>
              {/* One span, so the button's gap doesn't double the space before "observation". */}
              <span>
                Add<span className="ob-more"> observation</span>
              </span>
            </Button>
          </div>
        )}
      </div>
      {selected !== ALL && (
        <p className="ob-where" data-walk="site-walk.location">
          <Icon name="map-pin" size={15} color="var(--marsh-navy)" />
          {location ? locationLabel(pathOf(location)) : title}
        </p>
      )}
      <ProposalList
        proposal={s.proposal}
        media={s.media}
        selected={selected}
        filters={s.filters}
        onOpen={s.onOpen}
      />
      {!!rows.length && (
        <div className="swr-foot">
          <TableFooter
            late={onFix && incompleteCount(s.proposal) ? incompleteWords(s.proposal) : undefined}
            onLateClick={onFix}
          >
            {plural(rows.length, 'observation') + (toCheck ? ` · ${toCheck} to check` : '')}
          </TableFooter>
        </div>
      )}
    </div>
  )
}

// The deleted ones, the whole width with no navigator, as on the tab.
export function DeletedProposalTable({
  onRestore,
  ...s
}: Shared & { onRestore?: (ref: string) => void }) {
  return (
    <div className="ob-card">
      <div className="ob-filters">
        <div className="ob-filter-set">
          <ProposalFilterChips filters={s.filters} onChange={s.onFilters} />
        </div>
        <span className="ob-count">
          {plural(s.proposal.removed?.length ?? 0, 'deleted observation')}
        </span>
      </div>
      <DeletedProposalList
        proposal={s.proposal}
        media={s.media}
        filters={s.filters}
        onOpen={s.onOpen}
        onRestore={onRestore}
      />
    </div>
  )
}
