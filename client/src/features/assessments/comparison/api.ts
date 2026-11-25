// Gateway calls for the Comparison tab (RV-13): GET and POST
// /api/assessments/:reference/comparison, and POST
// …/comparison/:id/items/:item/decision (server/src/routes/comparison.routes.ts).
// The gateway answers each with the whole tab, so the screen never works out
// counts or New items itself.
import { request } from '../api'

export type Outcome = 'fixed' | 'improved' | 'unchanged' | 'worse' | 'not_checked'
export type ItemOutcome = Outcome | 'new'
export type Severity = 'critical' | 'high' | 'moderate' | 'low'
export type Confidence = 'high' | 'medium' | 'low'

export type PreviousReport = {
  reference: string
  siteVisitDate: string | null
  // The report's lead engineer, by name.
  engineer: string | null
}

// One finding or recommendation of the previous report, quoted as the report reads it.
export type PreviousItem = {
  key: string
  kind: 'finding' | 'recommendation'
  sectionId: string
  section: string
  heading: string | null
  quote: string
  // An OFI's Observation column.
  context: string | null
  severity: Severity | null
  priority: string | null
  categories: string[]
  location: string | null
}

// A piece of the current assessment's evidence, as it was compared.
export type CurrentSource = {
  key: string
  kind: 'observation' | 'finding' | 'recommendation'
  sectionId: string | null
  section: string
  title: string | null
  text: string
  severity: Severity | null
  priority: string | null
  categories: string[]
  location: string | null
  finding: string | null
  observationId: string | null
  // False once it was changed or deleted since the comparison ran.
  current: boolean
}

export type Figure = {
  name: string
  previous: string
  current: string
  source: string
  // Worked out by the gateway, e.g. "−0.6 bar"; null with a note when it can't be.
  difference: string | null
  note: string | null
}

// The engineer's latest decision on an item: who and when.
export type Decided = {
  action: string
  by: { id: string; name: string }
  at: string
  note: string | null
  // Kept from an earlier comparison by Compare again.
  carried: boolean
}

export type ComparisonItem = {
  key: string
  kind: 'previous' | 'new'
  previous: PreviousItem | null
  // A New item's current source, by key.
  source: string | null
  // null while sources disagree and the engineer has not decided.
  outcome: ItemOutcome | null
  // What the comparison said before any decision.
  suggested: ItemOutcome | null
  sources: string[]
  disagree: string[]
  possible: string[]
  reason: string | null
  missing: string | null
  confidence: Confidence
  figures: Figure[]
  severity: { previous: string; current: string; direction: -1 | 0 | 1 } | null
  corrections: string[]
  decided: Decided | null
  dismissed: boolean
  recheck: string | null
  categories: string[]
  locations: string[]
  level: Severity | null
}

export type ComparisonCounts = Record<ItemOutcome, number> & {
  undecided: number
  dismissed: number
  total: number
}

export type SourceChange = {
  kind: CurrentSource['kind']
  change: 'added' | 'deleted' | 'retagged' | 'edited' | 'changed'
  label: string
}

export type Comparison = {
  id: string
  previous: PreviousReport
  ranAt: string
  ranBy: { id: string; name: string }
  items: ComparisonItem[]
  counts: ComparisonCounts
  summary: string
  sources: CurrentSource[]
  outOfDate: { summary: string; changes: SourceChange[] } | null
  privacy: { enabled: boolean; masked_count: number } | null
}

export type ComparisonPage = {
  reference: string
  previousReports: PreviousReport[]
  previous: PreviousReport | null
  canChange: boolean
  readOnly: 'archived' | 'not_assigned' | null
  observations: number
  comparison: Comparison | null
  failure: { error: string; at: string } | null
  running: boolean
}

// accept, change the outcome, pair with other current sources (and say the
// outcome), unpair (all sources when none are named), dismiss or restore.
export type Decision = {
  action: 'accept' | 'outcome' | 'pair' | 'unpair' | 'dismiss' | 'restore'
  outcome?: Outcome
  sources?: string[]
  note?: string
}

const base = (reference: string) => `/api/assessments/${encodeURIComponent(reference)}/comparison`

export async function getComparison(
  reference: string,
  previous: string | null,
  signal?: AbortSignal,
): Promise<ComparisonPage> {
  const query = previous ? `?previous=${encodeURIComponent(previous)}` : ''
  return (await request<ComparisonPage>('GET', `${base(reference)}${query}`, undefined, signal))
    .data
}

export async function runComparison(reference: string, previous: string): Promise<ComparisonPage> {
  return (await request<ComparisonPage>('POST', base(reference), { previous })).data
}

export async function decideItem(
  reference: string,
  comparisonId: string,
  item: string,
  decision: Decision,
): Promise<ComparisonPage> {
  const path = `${base(reference)}/${encodeURIComponent(comparisonId)}/items/${encodeURIComponent(item)}/decision`
  return (await request<ComparisonPage>('POST', path, decision)).data
}
