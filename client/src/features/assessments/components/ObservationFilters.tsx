// The Observations tab's filters (CP-06, CP-08, CP-22): a search over every
// observation's evidence (CP-13), then one small menu each for category,
// severity, type and status. A filter that is set shows its value in place,
// with an ✕ to clear it, so the applied filters read at a glance.
// Rendered by screens/Observations.tsx; the filtering is in useAssessmentWorkflow.tsx.
import { Icon, SearchField } from '../../../design-system'
import { asChoices, catIcons, sevIcons, typeIcons } from '../filterChoices'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { ChoiceMenu, type Choice } from './ChoiceMenu'

type Key = 'cat' | 'sev' | 'type' | 'status'
// Returns the search, the four filter menus and, while two or more are set, Clear all.
export function ObservationFilters({ v }: { v: AssessmentWorkflow }) {
  const statusIcons = (choices: Choice[]) =>
    choices.map((c) =>
      !c.value
        ? c
        : c.value.endsWith('failed')
          ? { ...c, icon: 'circle-alert', color: 'var(--red-600)' }
          : c.value === 'Complete'
            ? { ...c, icon: 'circle-check', color: 'var(--green-600)' }
            : { ...c, icon: 'loader', color: 'var(--ink-600)' },
    )
  const menus: [Key, string, Choice[]][] = [
    ['cat', 'Category', catIcons(asChoices(v.obsCatFilterOptions))],
    ['sev', 'Severity', sevIcons(asChoices(v.obsSevFilterOptions))],
    ['type', 'Type', typeIcons(asChoices(v.obsTypeFilterOptions))],
    ['status', 'Status', statusIcons(asChoices(v.obsStatusFilterOptions))],
  ]
  // The search counts as one of them for Clear all.
  const set = v.obsFilterChips.length + (v.obsFilters.q.trim() ? 1 : 0)
  return (
    <>
      <SearchField
        className="ob-search"
        label="Search observations"
        placeholder="Search observations"
        value={v.obsFilters.q}
        onChange={(e) => v.setObsFilter('q', e.target.value)}
      />
      {menus.map(([key, name, choices]) => (
        <FilterChip
          key={key}
          name={name}
          choices={choices}
          value={v.obsFilters[key]}
          onChoose={(value) => v.setObsFilter(key, value)}
        />
      ))}
      {set > 1 && (
        <button type="button" className="ob-button ob-button--small" onClick={v.clearObsFilters}>
          {'Clear all'}
        </button>
      )}
    </>
  )
}

// One filter: "Severity ▾" until set, then "High ✕".
export function FilterChip({
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
  const chosen = value ? choices.find((c) => c.value === value) : undefined
  return (
    <span className="ob-chip" data-set={value ? '' : undefined}>
      <ChoiceMenu
        label={name}
        choices={choices}
        selected={[value]}
        onChoose={onChoose}
        trigger={(_, toggle) => (
          <button
            type="button"
            className="ob-chip-main"
            aria-label={chosen ? name + ': ' + chosen.label : name}
            onClick={toggle}
          >
            {chosen ? chosen.label : name}
            {!chosen && <Icon name="chevron-down" size={14} color="var(--text-muted)" />}
          </button>
        )}
      />
      {!!chosen && (
        <button
          type="button"
          className="ob-chip-clear"
          aria-label={'Clear ' + name.toLowerCase() + ' filter'}
          onClick={() => onChoose('')}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  )
}
