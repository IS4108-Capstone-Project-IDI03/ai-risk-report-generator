// How the Comparison tab (RV-13) words and filters what the gateway sends:
// outcome names and tones, filter choices and which items they keep, the
// "Showing 8 of 15 items" line, and each current source's label. Pure, so
// comparison.test.tsx checks it directly. Called by ComparisonTab and
// ComparisonDetail.
import { formatDay } from '../format'
import type {
  ComparisonCounts,
  ComparisonItem,
  CurrentSource,
  ItemOutcome,
  Outcome,
  Severity,
} from './api'

export const OUTCOME_LABEL: Record<ItemOutcome, string> = {
  worse: 'Worse',
  new: 'New',
  not_checked: 'Not checked',
  unchanged: 'Unchanged',
  improved: 'Improved',
  fixed: 'Fixed',
}

// The outcomes the engineer can choose for a previous item, in the list's order.
export const CHOOSABLE: Outcome[] = ['worse', 'not_checked', 'unchanged', 'improved', 'fixed']

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}

/**
 * Returns an item's outcome as its pill shows it, and the pill's tone: AI
 * violet while it is the comparison's suggestion, neutral once the engineer
 * decided it (AC "the AI marking turns neutral"), amber while its sources
 * disagree and nobody has chosen.
 */
export function outcomePill(item: Pick<ComparisonItem, 'outcome' | 'decided'>): {
  label: string
  tone: 'ai' | 'neutral' | 'moderate'
  icon: string | undefined
} {
  if (!item.outcome) return { label: 'Sources disagree', tone: 'moderate', icon: 'triangle-alert' }
  const label = OUTCOME_LABEL[item.outcome]
  return item.decided
    ? { label, tone: 'neutral', icon: 'check' }
    : { label, tone: 'ai', icon: 'sparkles' }
}

export type Filters = { outcome: string; category: string; severity: string; location: string }
export const ALL = 'all'
export const NO_FILTERS: Filters = { outcome: ALL, category: ALL, severity: ALL, location: ALL }

// Outcome filter values beyond the outcomes themselves.
export const TO_DECIDE = 'undecided'
export const DISMISSED = 'dismissed'

/**
 * Returns the items the filters keep, in the gateway's order. Dismissed items
 * show only under the Dismissed filter.
 */
export function filterItems(items: ComparisonItem[], f: Filters): ComparisonItem[] {
  return items.filter(
    (i) =>
      (f.outcome === DISMISSED
        ? i.dismissed
        : !i.dismissed &&
          (f.outcome === ALL ||
            (f.outcome === TO_DECIDE ? i.outcome === null : i.outcome === f.outcome))) &&
      (f.category === ALL || i.categories.includes(f.category)) &&
      (f.severity === ALL || i.level === f.severity) &&
      (f.location === ALL || i.locations.includes(f.location)),
  )
}

const COPE = ['Construction', 'Occupancy', 'Protection', 'Exposure']
const SEVERITIES: Severity[] = ['critical', 'high', 'moderate', 'low']

/** Returns each filter's choices, from what the items hold. */
export function filterChoices(items: ComparisonItem[], counts: ComparisonCounts) {
  const outcomes = (['worse', 'new', 'not_checked', 'unchanged', 'improved', 'fixed'] as const)
    .filter((o) => counts[o])
    .map((o) => ({ value: o, label: `${OUTCOME_LABEL[o]} (${counts[o]})` }))
  const categories = new Set(items.flatMap((i) => i.categories))
  const locations = [...new Set(items.flatMap((i) => i.locations))].sort((a, b) =>
    a.localeCompare(b),
  )
  return {
    outcome: [
      { value: ALL, label: 'All outcomes' },
      ...(counts.undecided
        ? [{ value: TO_DECIDE, label: `Sources disagree (${counts.undecided})` }]
        : []),
      ...outcomes,
      ...(counts.dismissed ? [{ value: DISMISSED, label: `Dismissed (${counts.dismissed})` }] : []),
    ],
    category: [
      { value: ALL, label: 'All categories' },
      ...COPE.filter((c) => categories.has(c)).map((c) => ({ value: c, label: c })),
    ],
    severity: [
      { value: ALL, label: 'All severities' },
      ...SEVERITIES.filter((s) => items.some((i) => i.level === s)).map((s) => ({
        value: s,
        label: SEVERITY_LABEL[s],
      })),
    ],
    location: [
      { value: ALL, label: 'All locations' },
      ...locations.map((l) => ({ value: l, label: l })),
    ],
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Returns the count line under the filters: always the number shown (AC "Order and filters"). */
export function shownLine(shown: number, total: number): string {
  return shown === total
    ? `Showing ${plural(total, 'item')}`
    : `Showing ${shown} of ${plural(total, 'item')}`
}

/** Returns a source's kind and where it is, e.g. "Observation · Pump room, B1". */
export function sourceLabel(s: Pick<CurrentSource, 'kind' | 'section' | 'title'>): string {
  const kind =
    s.kind === 'observation'
      ? 'Observation'
      : s.kind === 'finding'
        ? `Draft finding · ${s.section}`
        : 'Draft OFI'
  return s.title ? `${kind} · ${s.title}` : kind
}

/** Returns a source named so two at one place differ: its label and first words in quotes. */
export function sourceName(s: Pick<CurrentSource, 'kind' | 'section' | 'title' | 'text'>): string {
  const words = s.text.replace(/\s+/g, ' ').trim()
  const short = words.length > 50 ? `${words.slice(0, 48).trimEnd()}…` : words
  return `${sourceLabel(s)} (“${short}”)`
}

/** Returns a previous report's facts as one line: "RPT-2025-0410 · 10 Apr 2025 · Alex Rowe". */
export function reportLine(r: {
  reference: string
  siteVisitDate: string | null
  engineer: string | null
}) {
  return [
    r.reference,
    r.siteVisitDate ? `visited ${formatDay(new Date(r.siteVisitDate))}` : 'visit date not recorded',
    r.engineer ? `lead engineer ${r.engineer}` : 'lead engineer not recorded',
  ].join(' · ')
}

/** Returns an item's title in the list: the previous item's heading or section, else the New source's. */
export function itemTitle(item: ComparisonItem, sources: ReadonlyMap<string, CurrentSource>) {
  if (item.previous) return item.previous.heading ?? item.previous.section
  const s = item.source ? sources.get(item.source) : undefined
  return s ? sourceLabel(s) : 'New finding'
}

/** Returns an item's words in the list: the previous report's quote, or the New source's text. */
export function itemText(item: ComparisonItem, sources: ReadonlyMap<string, CurrentSource>) {
  if (item.previous) return item.previous.quote
  return (item.source && sources.get(item.source)?.text) || ''
}

/** Returns "Accepted by Alex Rowe on 24 Nov 2026", as a decision is shown. */
export function decidedLine(decided: NonNullable<ComparisonItem['decided']>) {
  const verb =
    decided.action === 'accept'
      ? 'Accepted'
      : decided.action === 'pair'
        ? 'Paired'
        : decided.action === 'unpair'
          ? 'Unpaired'
          : 'Outcome set'
  const when = formatDay(new Date(decided.at))
  return `${verb} by ${decided.by.name} on ${when}${decided.carried ? ', kept from the last comparison' : ''}`
}

/** Returns the tiles under the header: every outcome's count, the ones still to decide first. */
export function countTiles(counts: ComparisonCounts) {
  return [
    ...(counts.undecided
      ? [{ key: TO_DECIDE, label: 'Sources disagree', n: counts.undecided }]
      : []),
    ...(['worse', 'new', 'not_checked', 'unchanged', 'improved', 'fixed'] as const).map((o) => ({
      key: o,
      label: OUTCOME_LABEL[o],
      n: counts[o],
    })),
  ]
}
