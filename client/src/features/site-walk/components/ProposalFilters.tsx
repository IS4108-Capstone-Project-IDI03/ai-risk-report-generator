// A site walk proposal's table filters (CP-22 round 5, v2 in CP-24): the Observations tab's
// Category, Severity, Type and Status pills and Clear all, as the design system's FilterPill
// opening a ChoiceMenu (assessments/components/WorkToolbar.tsx does the same). Used by
// components/ProposalTables.tsx; the matching is proposal.ts matchesProposalFilters.
import { Button, ChoiceMenu, FilterPill, type Choice } from '../../../design-system'
import { asChoices, catIcons, sevIcons, typeIcons } from '../../assessments/filterChoices'
import { UNCATEGORISED } from '../../assessments/categories'
import { OBSERVATION_TYPES } from '../../assessments/observationFilters'
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from '../options'
import { NO_PROPOSAL_FILTERS, PROPOSAL_STATUSES, type ProposalFilters } from '../proposal'

// Each status wears the icon and colour of its Status column mark; To check is the amber
// triangle, as on the Observations tab.
const STATUS_ICON: Record<string, Pick<Choice, 'icon' | 'color'>> = {
  Ready: { icon: 'circle-check', color: 'var(--green-600)' },
  'To check': { icon: 'triangle-alert', color: 'var(--amber-600)' },
  'Needs details': { icon: 'circle-alert', color: 'var(--red-600)' },
}
const STATUS_CHOICES: Choice[] = [
  { value: '', label: 'All statuses' },
  ...PROPOSAL_STATUSES.map((s) => ({ value: s, label: s, ...STATUS_ICON[s] })),
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

/** Returns the four filter pills and, while two or more are set, Clear all. */
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
      {MENUS.map(([key, name, choices]) => {
        const chosen = choices.find((c) => c.value && c.value === filters[key])
        return (
          <ChoiceMenu
            key={key}
            label={name}
            choices={choices}
            selected={[filters[key]]}
            onChoose={(value) => onChange({ ...filters, [key]: value })}
            trigger={(_, toggle) => (
              <FilterPill
                label={chosen ? chosen.label : name}
                aria-label={chosen ? name + ': ' + chosen.label : name}
                active={!!chosen}
                onClick={toggle}
              />
            )}
          />
        )
      })}
      {set > 1 && (
        <Button variant="link-navy" size="sm" onClick={() => onChange(NO_PROPOSAL_FILTERS)}>
          Clear all
        </Button>
      )}
    </>
  )
}
