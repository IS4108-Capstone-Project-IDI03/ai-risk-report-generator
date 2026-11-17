// The filters of All Photos, All Handwritten Pages and All Recordings (CP-13),
// beside their search: Location, Category and Severity as on the Observations
// tab, and one about the item itself (a recording's or page's transcription,
// a photo's description). All in the browser, on the rows already listed.
import { IconRegistry } from '../../design-system'
import { hasCategory } from './categories'
import type { Choice } from './components/ChoiceMenu'
import { asChoices, catIcons, sevIcons } from './filterChoices'
import { matchesPlace, placeFilter } from './observationFilters'
import type { Observation, ObservationPage } from './types'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'

export type EvidenceFilters = { place: string; cat: string; sev: string; state: string }
export const NO_EVIDENCE_FILTERS: EvidenceFilters = { place: '', cat: '', sev: '', state: '' }

// A row as the filters see it: its observation, and what its item is.
export type FilteredRow = { observation: Observation; states: string[] }

export const matchesEvidence = (r: FilteredRow, f: EvidenceFilters) =>
  (!f.place || matchesPlace(r.observation, f.place)) &&
  (!f.cat || hasCategory(r.observation.cats, f.cat)) &&
  (!f.sev || r.observation.sev === f.sev) &&
  (!f.state || r.states.includes(f.state))

export const filtersSet = (f: EvidenceFilters) => Object.values(f).filter(Boolean).length

// What an item is, for its view's own filter. A page can be several at once:
// transcribed and corrected, or transcribed with unsure words.
const TRANSCRIBED = 'Transcribed'
const TRANSCRIBING = 'Transcribing'
const FAILED = 'Couldn’t transcribe'
const CORRECTED = 'Corrected'
const UNSURE = 'Has unsure words'
const DESCRIBED = 'Described'
const OUT_OF_DATE = 'Out of date'
const UNDESCRIBED = 'Not described'

const byStatus = { transcribed: TRANSCRIBED, transcribing: TRANSCRIBING, failed: FAILED }
export const recordingStates = (status: keyof typeof byStatus) => [byStatus[status]]
// A demo page written by hand has no status, only the engineer's text.
export const pageStates = (p: ObservationPage) => {
  if (p.status === null) return p.correction ? [TRANSCRIBED, CORRECTED] : []
  const states = [byStatus[p.status]]
  if (p.status === 'transcribed' && p.correction) states.push(CORRECTED)
  if (p.status === 'transcribed' && !p.correction && p.uncertain.length) states.push(UNSURE)
  return states
}
// A description written before this photo was added does not describe it.
export const photoStates = (d: { outOfDate: boolean; thisOne: boolean } | null) =>
  !d || !d.thisOne ? [UNDESCRIBED] : d.outOfDate ? [DESCRIBED, OUT_OF_DATE] : [DESCRIBED]

const STATE_ICON: Record<string, Pick<Choice, 'icon' | 'color'>> = {
  [TRANSCRIBED]: { icon: 'circle-check', color: 'var(--green-600)' },
  [TRANSCRIBING]: { icon: 'loader', color: 'var(--ink-600)' },
  [FAILED]: { icon: 'circle-alert', color: 'var(--red-600)' },
  [CORRECTED]: { icon: 'pencil', color: 'var(--ink-600)' },
  [UNSURE]: { icon: IconRegistry.evidence.uncertainty, color: 'var(--ai-fg)' },
  [DESCRIBED]: { icon: 'sparkles', color: 'var(--ai-fg)' },
  [OUT_OF_DATE]: { icon: 'history', color: 'var(--amber-600)' },
  [UNDESCRIBED]: { icon: 'circle-dashed', color: 'var(--text-muted)' },
}
const stateChoices = (all: string, states: string[]): Choice[] => [
  { value: '', label: all },
  ...states.map((s) => ({ value: s, label: s, ...STATE_ICON[s] })),
]
// Each view's own filter: its name and choices.
export const RECORDING_FILTER = {
  name: 'Status',
  choices: stateChoices('All statuses', [TRANSCRIBED, TRANSCRIBING, FAILED]),
}
export const PAGE_FILTER = {
  name: 'Status',
  choices: stateChoices('All statuses', [TRANSCRIBED, CORRECTED, UNSURE, TRANSCRIBING, FAILED]),
}
export const PHOTO_FILTER = {
  name: 'Description',
  choices: stateChoices('All photos', [DESCRIBED, OUT_OF_DATE, UNDESCRIBED]),
}

// One menu of the toolbar: its key in EvidenceFilters, name and choices.
export type FilterMenu = { key: keyof EvidenceFilters; name: string; choices: Choice[] }

// The four menus for a view's rows. The Location menu offers where its items
// are, by building and level as the Observations tab's filter does.
export function evidenceMenus(
  v: AssessmentWorkflow,
  rows: FilteredRow[],
  own: { name: string; choices: Choice[] },
): FilterMenu[] {
  const places = placeFilter(rows.map((r) => r.observation)).options.flatMap((g): Choice[] =>
    'options' in g ? g.options.map((o) => ({ ...o, group: g.label })) : [g as Choice],
  )
  return [
    { key: 'place', name: 'Location', choices: [{ value: '', label: 'All locations' }, ...places] },
    { key: 'cat', name: 'Category', choices: catIcons(asChoices(v.obsCatFilterOptions)) },
    { key: 'sev', name: 'Severity', choices: sevIcons(asChoices(v.obsSevFilterOptions)) },
    { key: 'state', ...own },
  ]
}
