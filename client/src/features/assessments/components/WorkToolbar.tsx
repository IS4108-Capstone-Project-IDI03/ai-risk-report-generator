// The Assessments card's toolbar (CP-23, boards 03 and 04): search, the Status /
// Report due / Type pills, the By client | All toggle, Sort and New assessment.
// Used by screens/Dashboard; the filtering itself is in useAssessmentWorkflow.tsx.
import { FilterPill, SearchField, SegmentedControl } from '../../../design-system'
import { NewAssessmentButton } from '../../new-assessment/components/NewAssessmentButton'
import type { DateFilter } from '../types'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { typeName } from '../workList'
import { ChoiceMenu, type Choice } from './ChoiceMenu'
import { SortPill } from './SortPill'

const DUE_CHOICES: Choice[] = [
  { value: 'overdue', label: 'Late', icon: 'circle-alert', color: 'var(--red-600)' },
  { value: 'due-soon', label: 'Due within 7 days', icon: 'calendar-clock' },
  { value: 'visit-soon', label: 'Site visit within 7 days', icon: 'map-pin' },
]

// One filter pill: its name until set, then the chosen word. "Any ..." clears it.
function Filter({
  name,
  choices,
  value,
  onChoose,
}: {
  name: string
  choices: Choice[]
  value: string
  onChoose: (value: string) => void
}) {
  const chosen = choices.find((c) => c.value === value)
  return (
    <ChoiceMenu
      label={name}
      choices={[{ value: '', label: 'Any ' + name.toLowerCase() }, ...choices]}
      selected={[value]}
      onChoose={onChoose}
      trigger={(_, toggle) => (
        <FilterPill
          label={chosen ? chosen.label : name}
          aria-label={chosen ? name + ': ' + chosen.label : name}
          data-set={chosen ? '' : undefined}
          onClick={toggle}
        />
      )}
    />
  )
}

// `compact` (under 1024 px): New assessment lives in the top bar instead (screens/Dashboard).
export function WorkToolbar({ v, compact }: { v: AssessmentWorkflow; compact: boolean }) {
  const asChoices = (values: string[]) => values.map((value) => ({ value, label: value }))
  return (
    <div className="at-toolbar">
      <SearchField
        className="at-search"
        label="Search assessments"
        placeholder="Search site, client or report ID"
        value={v.q}
        onChange={v.setQ}
      />
      <div className="at-pills">
        <Filter
          name="Status"
          choices={asChoices(v.statusOptions)}
          value={v.statusFilter}
          onChoose={v.setStatusFilter}
        />
        <Filter
          name="Report due"
          choices={DUE_CHOICES}
          value={v.dateFilter ?? ''}
          onChoose={(value) => v.setDateFilter((value || null) as DateFilter | null)}
        />
        <Filter
          name="Type"
          choices={v.visitTypeOptions.map((value) => ({ value, label: typeName(value) }))}
          value={v.visitType}
          onChoose={v.setVisitType}
        />
        <ChoiceMenu
          label="Sort assessments"
          align="right"
          className="at-sort-anchor"
          choices={v.sortOptions.map((value, i) => ({
            value,
            label: value,
            icon: ['calendar', 'calendar-clock', 'arrow-down-a-z'][i],
          }))}
          selected={[v.workSort]}
          onChoose={v.setWorkSort}
          trigger={(_, toggle) => (
            <SortPill name="Sort assessments" label={v.workSort} onClick={toggle} />
          )}
        />
      </div>
      <div className="at-tools">
        <SegmentedControl
          ariaLabel="Group assessments"
          options={[
            { value: 'client', label: 'By client', icon: 'layers' },
            { value: 'all', label: 'All', icon: 'list' },
          ]}
          value={v.workByClient ? 'client' : 'all'}
          onChange={(value) =>
            value === (v.workByClient ? 'all' : 'client') && v.toggleWorkByClient()
          }
        />
        {!!v.canEdit && !compact && <NewAssessmentButton onStart={v.goCreate} />}
      </div>
    </div>
  )
}
