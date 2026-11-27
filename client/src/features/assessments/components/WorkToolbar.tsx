// The Assessments card's toolbar (CP-23, boards 03 and 04): search, the Stage /
// Report due / Type pills, the By client | All toggle, Sort and New assessment.
// Used by screens/Dashboard; the filtering itself is in useAssessmentWorkflow.tsx.
import {
  ASSESSMENT_TYPES,
  ChoiceMenu,
  FilterPill,
  ListToolbar,
  SearchField,
  SegmentedControl,
  statusLook,
  useIsPhone,
  type Choice,
} from '../../../design-system'
import { NewAssessmentButton } from '../../new-assessment/components/NewAssessmentButton'
import type { DateFilter } from '../types'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { typeName } from '../workList'
import { SortPill } from './SortPill'

const DUE_CHOICES: Choice[] = [
  // Late and Due soon wear the icon and colour of the Report due column's states.
  { value: 'overdue', label: 'Late', icon: 'calendar-x', color: 'var(--red-600)' },
  {
    value: 'due-soon',
    label: 'Due within 7 days',
    icon: 'calendar-clock',
    color: 'var(--amber-600)',
  },
  { value: 'visit-soon', label: 'Site visit within 7 days', icon: 'map-pin' },
]

// One filter pill: its name until set, then the chosen word. "Any ..." clears it.
function Filter({
  name,
  choices,
  value,
  onChoose,
  walk,
}: {
  name: string
  choices: Choice[]
  value: string
  onChoose: (value: string) => void
  // The walkthrough's tag for this pill (F-12).
  walk: string
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
          active={!!chosen}
          data-walk={walk}
          onClick={toggle}
        />
      )}
    />
  )
}

// `compact` (under 1024 px): New assessment lives in the top bar instead (screens/Dashboard).
export function WorkToolbar({ v, compact }: { v: AssessmentWorkflow; compact: boolean }) {
  // A tablet's search is squeezed by the pills, so it says only "Search"; a phone has its own full row.
  const phone = useIsPhone()
  const tablet = compact && !phone
  return (
    <ListToolbar
      className="at-toolbar"
      search={
        <SearchField
          className="at-search"
          label="Search assessments"
          walk="assessments.search"
          placeholder={tablet ? 'Search' : 'Search site, client or report ID'}
          value={v.q}
          onChange={v.setQ}
        />
      }
      filters={
        <>
          <Filter
            name="Stage"
            walk="assessments.filter-stage"
            // Each stage wears the icon and colour of its pill, so the two read as one thing.
            choices={v.stageOptions.map((value) => {
              const { icon, fg, ink } = statusLook(value)
              return { value, label: value, icon, color: ink ?? fg }
            })}
            value={v.stageFilter}
            onChoose={v.setStageFilter}
          />
          <Filter
            name="Report due"
            walk="assessments.filter-due"
            choices={DUE_CHOICES}
            value={v.dateFilter ?? ''}
            onChoose={(value) => v.setDateFilter((value || null) as DateFilter | null)}
          />
          <Filter
            name="Type"
            walk="assessments.filter-type"
            choices={v.visitTypeOptions.map((value) => {
              const name = typeName(value)
              return {
                value,
                label: name,
                icon: ASSESSMENT_TYPES[name].icon,
                color: ASSESSMENT_TYPES[name].fg,
              }
            })}
            value={v.visitType}
            onChoose={v.setVisitType}
          />
        </>
      }
      sort={
        <ChoiceMenu
          label="Sort assessments"
          align="right"
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
      }
      end={
        <>
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
        </>
      }
    />
  )
}
