// A site walk proposal's table filters (CP-22 round 5): the Observations tab's
// own Category, Severity, Type and Status chips and Clear all
// (assessments/components/ObservationFilters.tsx). Used by screens/Review.tsx;
// the matching is proposal.ts matchesProposalFilters.
import type { Choice } from '../../assessments/components/ChoiceMenu'
import { FilterChip } from '../../assessments/components/ObservationFilters'
import { asChoices, catIcons, sevIcons, typeIcons } from '../../assessments/filterChoices'
import { UNCATEGORISED } from '../../assessments/categories'
import { OBSERVATION_TYPES } from '../../assessments/observationFilters'
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from '../options'
import { NO_PROPOSAL_FILTERS, PROPOSAL_STATUSES, type ProposalFilters } from '../proposal'

// Ready has the green tick, Needs details the red alert, as in the Status column.
const STATUS_CHOICES: Choice[] = [
  { value: '', label: 'All statuses' },
  ...PROPOSAL_STATUSES.map((s) =>
    s === 'Ready'
      ? { value: s, label: s, icon: 'circle-check', color: 'var(--green-600)' }
      : { value: s, label: s, icon: 'circle-alert', color: 'var(--red-600)' },
  ),
]
const MENUS: [keyof ProposalFilters, string, Choice[]][] = [
  [
    'cat',
    'Category',
    catIcons([
      { value: '', label: 'All categories' },
      ...CATEGORY_OPTIONS,
      ...asChoices([UNCATEGORISED]),
    ]),
  ],
  ['sev', 'Severity', sevIcons([{ value: '', label: 'All severities' }, ...SEVERITY_OPTIONS])],
  ['type', 'Type', typeIcons(asChoices([{ value: '', label: 'All types' }, ...OBSERVATION_TYPES]))],
  ['status', 'Status', STATUS_CHOICES],
]

export function ProposalFilterChips({
  filters,
  onChange,
}: {
  filters: ProposalFilters
  onChange: (filters: ProposalFilters) => void
}) {
  const set = Object.values(filters).filter(Boolean).length
  return (
    <>
      {MENUS.map(([key, name, choices]) => (
        <FilterChip
          key={key}
          name={name}
          choices={choices}
          value={filters[key]}
          onChoose={(value) => onChange({ ...filters, [key]: value })}
        />
      ))}
      {set > 1 && (
        <button
          type="button"
          className="ob-button ob-button--small"
          onClick={() => onChange(NO_PROPOSAL_FILTERS)}
        >
          Clear all
        </button>
      )}
    </>
  )
}
