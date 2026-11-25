// The Observations tab's toolbar (CP-06, CP-08, CP-22, CP-24): one row of a search over every
// observation's evidence (CP-13), the Category, Severity, Type and Status pills and, at the
// right end, whatever `children` hold (the Add observation button, or the deleted list's
// count). A pill that is set shows its value (board 03) and an ✕ that clears it, so the applied
// filters read at a glance. Rendered by screens/Observations.tsx; the filtering is in
// useAssessmentWorkflow.tsx. PillFilter is shared with All Photos, Pages and Recordings
// (PhotoTable.tsx); FilterChip below is the older chip, still used by the site walk tables.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FilterPill, Icon, SearchField } from '../../../design-system'
import { asChoices, catIcons, sevIcons, typeIcons } from '../filterChoices'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { ChoiceMenu, type Choice } from './ChoiceMenu'

type Key = 'cat' | 'sev' | 'type' | 'status'

// Each status wears the icon and colour of its row mark (v2: options keep their icons).
const STATUS_LOOK: Record<string, [string, string]> = {
  Transcribing: ['loader-circle', 'var(--marsh-navy)'],
  Reading: ['loader-circle', 'var(--marsh-navy)'],
  'To check': ['triangle-alert', 'var(--amber-600)'],
  'Transcription failed': ['circle-alert', 'var(--red-600)'],
  'Reading failed': ['circle-alert', 'var(--red-600)'],
  Complete: ['circle-check', 'var(--green-600)'],
}
const statusIcons = (choices: Choice[]) =>
  choices.map((c) => {
    const look = STATUS_LOOK[c.value]
    return look ? { ...c, icon: look[0], color: look[1] } : c
  })

/** Returns the search, the four filter pills, Clear all while two or more are set, then `children`. */
export function ObservationFilters({
  v,
  children,
}: {
  v: AssessmentWorkflow
  children?: ReactNode
}) {
  const menus: [Key, string, Choice[]][] = [
    ['cat', 'Category', catIcons(asChoices(v.obsCatFilterOptions))],
    ['sev', 'Severity', sevIcons(asChoices(v.obsSevFilterOptions))],
    ['type', 'Type', typeIcons(asChoices(v.obsTypeFilterOptions))],
    ['status', 'Status', statusIcons(asChoices(v.obsStatusFilterOptions))],
  ]
  // The search counts as one of them for Clear all.
  const set = v.obsFilterChips.length + (v.obsFilters.q.trim() ? 1 : 0)
  // A search too narrow for its words (a laptop, sidebar open) says just "Search"; without
  // this the placeholder is cut mid-word. The field's aria-label stays whole.
  const bar = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const field = bar.current?.querySelector('.ob-bar-search')
    if (!field || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 210))
    watch.observe(field)
    return () => watch.disconnect()
  }, [])
  return (
    <div className="ob-bar" ref={bar}>
      <SearchField
        className="ob-bar-search"
        walk="observations.search"
        label="Search observations"
        placeholder={narrow ? 'Search' : 'Search observations'}
        value={v.obsFilters.q}
        onChange={(e) => v.setObsFilter('q', e.target.value)}
      />
      <div className="ob-bar-pills">
        {menus.map(([key, name, choices]) => (
          <PillFilter
            key={key}
            name={name}
            choices={choices}
            value={v.obsFilters[key]}
            onChoose={(value) => v.setObsFilter(key, value)}
            // F-12: the search and the last pill frame the filters (the pills' wrapper has no box).
            walk={key === 'status' ? 'observations.filter-status' : undefined}
          />
        ))}
        {set > 1 && (
          <button type="button" className="ob-button ob-button--small" onClick={v.clearObsFilters}>
            {'Clear all'}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/** Returns one filter pill: its name until set, then the chosen word with an ✕ (in place of the
 chevron) that clears it. */
export function PillFilter({
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
  walk?: string
}) {
  const chosen = value ? choices.find((c) => c.value === value) : undefined
  return (
    <span className="ob-fp" data-set={chosen ? '' : undefined} data-walk={walk}>
      <ChoiceMenu
        label={name}
        choices={choices}
        selected={[value]}
        onChoose={onChoose}
        trigger={(_, toggle) => (
          <FilterPill
            label={chosen ? chosen.label : name}
            aria-label={chosen ? name + ': ' + chosen.label : name}
            onClick={toggle}
          />
        )}
      />
      {!!chosen && (
        <button
          type="button"
          className="ob-fp-clear"
          aria-label={'Clear ' + name.toLowerCase() + ' filter'}
          onClick={() => onChoose('')}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
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
