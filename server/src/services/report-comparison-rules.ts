// The rules of a report comparison (RV-13), as pure functions: what the
// gateway decides after the model suggests an outcome for each previous item
// (silence is never a fix, a severity change is Worse or Improved, sources that
// disagree are left to the engineer), each figure's difference, the
// confidence, and, on every read, the items as the engineer's decisions leave
// them: New items, counts, order, what changed since the run, and which
// decisions Compare again keeps. Called by report-comparison.service; tested
// by test/comparison-rules.test.ts.
import type {
  ComparisonOutcome,
  ICurrentSource,
  IComparisonDecision,
  IComparisonFigure,
  IComparisonItem,
  IPreviousItem,
  ItemOutcome,
} from '../models/report-comparison.model'
import type { ConfidenceLevel } from '../models/assistant-conversation.model'
import type { Severity } from '../models/observation.model'

// Bump when a rule here changes what a comparison holds.
export const COMPARISON_RULES = 'rv13-rules-v1'

// ---- Severity and priority -------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 }
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}

// "Priority 1" is the most urgent of Marsh's four: rank 4. null for anything else.
export function priorityRank(priority: string | null): number | null {
  const n = /^Priority\s*([1-4])$/i.exec(priority?.trim() ?? '')
  return n ? 5 - Number(n[1]) : null
}

/** Returns the highest severity among those given, or null for none. */
export function highest(severities: readonly (Severity | null | undefined)[]): Severity | null {
  let top: Severity | null = null
  for (const s of severities) if (s && (!top || SEVERITY_RANK[s] > SEVERITY_RANK[top])) top = s
  return top
}

export type SeverityChange = { previous: string; current: string; direction: -1 | 0 | 1 }

/**
 * Returns a matched pair's severities, as both reports give them, and which
 * way they moved: the previous item's severity against the highest of its
 * current sources', or an OFI's priority against theirs. null when either
 * side has none on the same scale.
 */
export function severityChange(
  previous: Pick<IPreviousItem, 'severity' | 'priority'>,
  sources: readonly Pick<ICurrentSource, 'severity' | 'priority'>[],
): SeverityChange | null {
  const now = highest(sources.map((s) => s.severity))
  if (previous.severity && now) {
    const d = Math.sign(SEVERITY_RANK[now] - SEVERITY_RANK[previous.severity]) as -1 | 0 | 1
    return {
      previous: SEVERITY_LABEL[previous.severity],
      current: SEVERITY_LABEL[now],
      direction: d,
    }
  }
  const was = priorityRank(previous.priority)
  const ranked = sources
    .flatMap((s) => {
      const rank = priorityRank(s.priority)
      return rank === null || !s.priority ? [] : [{ priority: s.priority, rank }]
    })
    .sort((a, b) => b.rank - a.rank)
  if (was === null || !ranked.length) return null
  return {
    previous: previous.priority!,
    current: ranked[0].priority,
    direction: Math.sign(ranked[0].rank - was) as -1 | 0 | 1,
  }
}

// ---- Figures ---------------------------------------------------------------

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()
const NUMBER = /[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g

type Parsed = { digits: bigint; decimals: number; prefix: string; suffix: string; commas: boolean }

// A figure written as one number with its unit around it: "4.5 bar", "SGD 1,200,000",
// "12 m". null when it holds no number or more than one ("1 in 2", "2-3 hours").
function parse(text: string): Parsed | null {
  const t = tidy(text)
  const found = [...t.matchAll(NUMBER)]
  if (found.length !== 1) return null
  const [match] = found
  const written = match[0].replace('−', '-')
  const [whole, fraction = ''] = written.replace(/,/g, '').split('.')
  const negative = whole.startsWith('-')
  const magnitude = BigInt(whole.replace('-', '') + fraction)
  return {
    digits: negative ? -magnitude : magnitude,
    decimals: fraction.length,
    prefix: t.slice(0, match.index),
    suffix: t.slice(match.index! + match[0].length),
    commas: written.includes(','),
  }
}

const unitOf = (p: Parsed) => `${p.prefix.trim().toLowerCase()}|${p.suffix.trim().toLowerCase()}`

function written(value: bigint, decimals: number, commas: boolean): string {
  const text = value.toString().padStart(decimals + 1, '0')
  const whole = text.slice(0, text.length - decimals) || '0'
  const grouped = commas ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole
  return decimals ? `${grouped}.${text.slice(-decimals)}` : grouped
}

/**
 * Returns the difference between two figures as written, current less
 * previous, with the unit (e.g. "−0.6 bar"); "No change" when equal. Worked
 * out on the digits as written, so 7.5 − 6.9 is exactly 0.6. null with a note
 * when the two are not one number each or their units differ.
 */
export function figureDifference(
  previous: string,
  current: string,
): { difference: string | null; note: string | null } {
  const a = parse(previous)
  const b = parse(current)
  if (!a || !b) return { difference: null, note: 'Not one number each, so no difference is shown.' }
  if (unitOf(a) !== unitOf(b))
    return { difference: null, note: 'The units differ, so no difference is shown.' }
  const decimals = Math.max(a.decimals, b.decimals)
  const scale = (p: Parsed) => p.digits * 10n ** BigInt(decimals - p.decimals)
  const change = scale(b) - scale(a)
  if (change === 0n) return { difference: 'No change', note: null }
  const sign = change > 0n ? '+' : '−'
  const size = written(change < 0n ? -change : change, decimals, a.commas || b.commas)
  return { difference: `${sign}${b.prefix}${size}${b.suffix}`, note: null }
}

// ---- Settling the model's answer ------------------------------------------

// One entry of S4's answer (rag-service app/comparison/compare.py), labels and all.
export type SuggestedItem = {
  previous: string
  outcome: ComparisonOutcome
  sources: string[]
  match: 'clear' | 'partial'
  disagree: string[]
  possible: string[]
  reason: string | null
  missing: string | null
  figures: { name: string; previous: string; current: string; source: string }[]
  omitted: boolean
}

const COVERS = new Set<ComparisonOutcome>(['fixed', 'improved', 'unchanged', 'worse'])
const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 }
const atMost = (level: ConfidenceLevel, cap: ConfidenceLevel): ConfidenceLevel =>
  CONFIDENCE_RANK[level] <= CONFIDENCE_RANK[cap] ? level : cap

/** Returns why a previous item is Not checked when the model gave no reason. */
export function missingFallback(item: Pick<IPreviousItem, 'kind' | 'section'>): string {
  return `No observation, draft finding or draft OFI in this assessment says what this ${
    item.kind === 'recommendation' ? 'recommendation' : 'finding'
  } from ${item.section} is now.`
}

/**
 * Returns the comparison's outcome for one previous item, after the rules:
 * - an outcome other than Not checked with no current source is Not checked
 *   (silence is not a fix), and Not checked lists no source;
 * - a matched pair whose severities (or OFI priorities) differ is Worse or
 *   Improved, whatever the model said;
 * - current sources that disagree leave the outcome to the engineer (null)
 *   and cap confidence at Medium;
 * - a figure is kept only when both values are written in their texts
 *   exactly as the model copied them, and its difference is worked out here.
 * Confidence: Low when a rule changed the model's outcome or the model left
 * the item out; Medium for a partial match, possible matches left apart, a
 * dropped figure or disagreeing sources; High otherwise.
 */
export function settleItem(
  suggested: SuggestedItem,
  previous: IPreviousItem,
  byLabel: ReadonlyMap<string, ICurrentSource>,
): IComparisonItem {
  const keysOf = (labels: string[]) => [
    ...new Set(labels.flatMap((l) => (byLabel.has(l) ? [byLabel.get(l)!.key] : []))),
  ]
  const corrections: string[] = suggested.omitted ? ['omitted'] : []
  let sources = keysOf(suggested.sources)
  let possible = keysOf(suggested.possible).filter((k) => !sources.includes(k))
  let outcome: ComparisonOutcome | null = suggested.outcome
  if (outcome === 'not_checked' && sources.length) {
    // Evidence the model named but did not judge covers it is only a possible match.
    possible = [...possible, ...sources]
    sources = []
  }
  if (COVERS.has(outcome) && !sources.length) {
    outcome = 'not_checked'
    corrections.push('no_source')
  }
  const disagree = keysOf(suggested.disagree).filter((k) => sources.includes(k))
  const byKey = new Map([...byLabel.values()].map((s) => [s.key, s]))
  const inPair = sources.map((k) => byKey.get(k)!)
  const change = sources.length ? severityChange(previous, inPair) : null
  if (disagree.length > 1) outcome = null
  else if (change && change.direction !== 0 && outcome !== 'not_checked') {
    const wanted: ComparisonOutcome = change.direction > 0 ? 'worse' : 'improved'
    if (outcome !== wanted) corrections.push('severity')
    outcome = wanted
  }
  const said = tidy([previous.quote, previous.context ?? ''].join(' '))
  const figures: IComparisonFigure[] = []
  for (const f of suggested.figures) {
    const source = byLabel.get(f.source)
    if (
      !source ||
      !sources.includes(source.key) ||
      !tidy(f.previous) ||
      !tidy(f.current) ||
      !said.includes(tidy(f.previous)) ||
      !tidy(source.text).includes(tidy(f.current))
    ) {
      if (!corrections.includes('figure')) corrections.push('figure')
      continue
    }
    figures.push({
      name: f.name || 'Figure',
      previous: tidy(f.previous),
      current: tidy(f.current),
      source: source.key,
      ...figureDifference(f.previous, f.current),
    })
  }
  let confidence: ConfidenceLevel =
    outcome === 'not_checked'
      ? possible.length
        ? 'medium'
        : 'high'
      : suggested.match === 'clear'
        ? 'high'
        : 'medium'
  if (corrections.includes('figure') || possible.length) confidence = atMost(confidence, 'medium')
  if (disagree.length > 1) confidence = atMost(confidence, 'medium')
  if (corrections.some((c) => c === 'no_source' || c === 'severity' || c === 'omitted'))
    confidence = 'low'
  return {
    key: previous.key,
    outcome,
    suggested: suggested.outcome,
    sources,
    disagree: disagree.length > 1 ? disagree : [],
    possible,
    reason: outcome === 'not_checked' ? null : suggested.reason,
    missing:
      outcome === 'not_checked'
        ? suggested.omitted
          ? 'The comparison gave no outcome for this item, so it is shown as not checked.'
          : (suggested.missing ?? missingFallback(previous))
        : null,
    confidence,
    figures,
    corrections,
  }
}

// ---- Reading a comparison --------------------------------------------------

type Stamp = { id: string; name: string }

// One item as the tab shows it: a previous item with its outcome, or a New one.
export type ComparisonItemView = {
  key: string
  kind: 'previous' | 'new'
  previous: IPreviousItem | null
  // The New item's current source, by key.
  source: string | null
  outcome: ItemOutcome | null
  // What the comparison said, before any decision.
  suggested: ItemOutcome | null
  sources: string[]
  disagree: string[]
  possible: string[]
  reason: string | null
  missing: string | null
  confidence: ConfidenceLevel
  figures: IComparisonFigure[]
  severity: SeverityChange | null
  corrections: string[]
  // The engineer's latest decision; null while the outcome is the comparison's.
  decided: { action: string; by: Stamp; at: Date; note: string | null; carried: boolean } | null
  dismissed: boolean
  // Why Compare again flagged it, until the engineer decides it again.
  recheck: string | null
  // What the filters read: every COPE category and location on either side,
  // and the severity now, else the previous one.
  categories: string[]
  locations: string[]
  level: Severity | null
}

export type ComparisonCounts = Record<ItemOutcome, number> & {
  // Sources disagree and the engineer has not decided yet.
  undecided: number
  dismissed: number
  total: number
}

type Comparison = {
  createdAt: Date
  previousItems: IPreviousItem[]
  sources: ICurrentSource[]
  items: IComparisonItem[]
  recheck: { item: string; reason: string }[]
  decisions: IComparisonDecision[]
}

// Dismissing and restoring hide and show an item; they decide nothing about it.
const isChoice = (d: IComparisonDecision) => d.action !== 'dismiss' && d.action !== 'restore'

// Each item's latest decision, and its latest that chose its outcome or sources.
function latestDecisions(decisions: readonly IComparisonDecision[]) {
  const latest = new Map<string, IComparisonDecision>()
  const chosen = new Map<string, IComparisonDecision>()
  for (const d of decisions) {
    latest.set(d.item, d)
    if (isChoice(d)) chosen.set(d.item, d)
  }
  return { latest, chosen }
}

const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.flatMap((v) => (v ? [v] : []))),
]

/**
 * Returns the current sources no previous item is compared with: New items.
 * A draft finding or OFI stands for the observations it cites, so an
 * observation cited by one is never New on its own, and one is not New once
 * any observation it cites is compared with a previous item.
 */
export function unpaired(sources: readonly ICurrentSource[], paired: ReadonlySet<string>) {
  const observationKey = (id: string) => `O:${id}`
  const cited = new Set(
    sources
      .filter((s) => s.kind !== 'observation')
      .flatMap((s) => s.observations.map(observationKey)),
  )
  const pairedObservations = new Set(
    sources
      .filter((s) => paired.has(s.key))
      .flatMap((s) => (s.kind === 'observation' ? [s.key] : s.observations.map(observationKey))),
  )
  return sources.filter((s) =>
    s.kind === 'observation'
      ? !paired.has(s.key) && !cited.has(s.key) && !pairedObservations.has(s.key)
      : !paired.has(s.key) &&
        !s.observations.some((o) => pairedObservations.has(observationKey(o))),
  )
}

/**
 * Returns the comparison's items as the engineer's decisions leave them, New
 * ones included, and their counts. A decision records the item's whole state,
 * so the latest one on an item is what it reads; until then it is the
 * comparison's (the AI marking).
 */
export function foldComparison(c: Comparison): {
  items: ComparisonItemView[]
  counts: ComparisonCounts
} {
  const { latest, chosen } = latestDecisions(c.decisions)
  const byKey = new Map(c.sources.map((s) => [s.key, s]))
  const flagged = new Map(c.recheck.map((r) => [r.item, r.reason]))
  const decidedView = (d: IComparisonDecision | undefined) =>
    d
      ? {
          action: d.action,
          by: { id: d.by.id, name: d.by.name },
          at: d.at,
          note: d.note,
          carried: !!d.carriedFrom,
        }
      : null
  // Compare again's flag stands until the engineer decides the item in this comparison.
  const recheckOf = (key: string, d: IComparisonDecision | undefined) =>
    d && !d.carriedFrom ? null : (flagged.get(key) ?? null)
  const filterTags = (sides: { categories: string[]; location: string | null }[]) => ({
    categories: unique(sides.flatMap((s) => s.categories)),
    locations: unique(sides.map((s) => s.location)),
  })

  const previous = c.previousItems.flatMap<ComparisonItemView>((p) => {
    const item = c.items.find((i) => i.key === p.key)
    if (!item) return []
    const d = chosen.get(p.key)
    const sources = d ? d.sources.filter((k) => byKey.has(k)) : item.sources
    const inPair = sources.map((k) => byKey.get(k)!)
    const severity = sources.length ? severityChange(p, inPair) : null
    return [
      {
        key: p.key,
        kind: 'previous',
        previous: p,
        source: null,
        outcome: d ? d.outcome : item.outcome,
        suggested: item.outcome,
        sources,
        // An engineer's pairing settles a disagreement.
        disagree: d ? [] : item.disagree,
        possible: item.possible.filter((k) => !sources.includes(k)),
        reason: item.reason,
        missing: item.missing,
        confidence: item.confidence,
        figures: item.figures.filter((f) => sources.includes(f.source)),
        severity,
        corrections: item.corrections,
        decided: decidedView(d),
        dismissed: latest.get(p.key)?.dismissed ?? false,
        recheck: recheckOf(p.key, d),
        ...filterTags([p, ...inPair]),
        level: highest(inPair.map((s) => s.severity)) ?? p.severity,
      },
    ]
  })

  const paired = new Set(previous.filter((i) => !i.dismissed).flatMap((i) => i.sources))
  const possibleFor = new Set(previous.flatMap((i) => i.possible))
  const fresh = unpaired(c.sources, paired).map<ComparisonItemView>((s) => {
    const key = `N:${s.key}`
    const d = chosen.get(key)
    return {
      key,
      kind: 'new',
      previous: null,
      source: s.key,
      outcome: 'new',
      suggested: 'new',
      sources: [s.key],
      disagree: [],
      possible: [],
      reason: null,
      missing: null,
      // Worked out in code, not suggested: Medium only when a previous item may be the same.
      confidence: possibleFor.has(s.key) ? 'medium' : 'high',
      figures: [],
      severity: null,
      corrections: [],
      decided: decidedView(d),
      dismissed: latest.get(key)?.dismissed ?? false,
      recheck: recheckOf(key, d),
      ...filterTags([s]),
      level: s.severity,
    }
  })

  const items = [...previous, ...fresh]
  const counts: ComparisonCounts = {
    fixed: 0,
    improved: 0,
    unchanged: 0,
    worse: 0,
    not_checked: 0,
    new: 0,
    undecided: 0,
    dismissed: 0,
    total: 0,
  }
  for (const i of items) {
    if (i.dismissed) {
      counts.dismissed += 1
      continue
    }
    counts.total += 1
    if (i.outcome) counts[i.outcome] += 1
    else counts.undecided += 1
  }
  return { items: orderItems(items, byKey), counts }
}

// The order the tab lists them in (AC "Order and filters"): Worse first, then New
// at Critical or High severity (or Priority 1), then items whose sources
// disagree (waiting for the engineer), Not checked, the other New ones,
// Unchanged, Improved and Fixed; dismissed ones last. Within a group, the
// previous report's order, then the current evidence's.
function rank(i: ComparisonItemView, byKey: ReadonlyMap<string, ICurrentSource>): number {
  if (i.dismissed) return 9
  if (i.outcome === 'worse') return 0
  if (i.outcome === 'new') {
    const s = i.source ? byKey.get(i.source) : undefined
    const urgent =
      s && ((s.severity && SEVERITY_RANK[s.severity] >= 3) || priorityRank(s.priority) === 4)
    return urgent ? 1 : 4
  }
  if (i.outcome === null) return 2
  return { not_checked: 3, unchanged: 5, improved: 6, fixed: 7 }[i.outcome]
}

export function orderItems(
  items: ComparisonItemView[],
  byKey: ReadonlyMap<string, ICurrentSource>,
): ComparisonItemView[] {
  const position = new Map(items.map((item, n) => [item.key, n]))
  return [...items].sort(
    (a, b) => rank(a, byKey) - rank(b, byKey) || position.get(a.key)! - position.get(b.key)!,
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Returns the counts as one line: "3 fixed, 2 worse, 5 unchanged, 4 new, 1 not checked". */
export function countsLine(counts: ComparisonCounts): string {
  const parts = [
    counts.fixed && `${counts.fixed} fixed`,
    counts.improved && `${counts.improved} improved`,
    counts.worse && `${counts.worse} worse`,
    counts.unchanged && `${counts.unchanged} unchanged`,
    counts.new && `${counts.new} new`,
    counts.not_checked && `${counts.not_checked} not checked`,
    counts.undecided && `${counts.undecided} to decide`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'No items'
}

// ---- What changed since a comparison ---------------------------------------

export type SourceChange = {
  kind: ICurrentSource['kind']
  change: 'added' | 'deleted' | 'retagged' | 'edited' | 'changed'
  // Short words to name it: an observation's location and first words, a finding's words.
  label: string
}

const snippet = (s: Pick<ICurrentSource, 'title' | 'text'>) => {
  const words = tidy(s.text)
  const short = words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words
  return s.title ? `${s.title}: ${short}` : short
}

/**
 * Returns what differs between the evidence a comparison was run on and the
 * evidence now: observations added, deleted, retagged (category, severity or
 * location) or edited, and draft findings and OFIs added, removed or changed.
 */
export function changesSince(
  then: readonly ICurrentSource[],
  now: readonly ICurrentSource[],
): SourceChange[] {
  const before = new Map(then.map((s) => [s.key, s]))
  const after = new Map(now.map((s) => [s.key, s]))
  const changes: SourceChange[] = []
  for (const s of now) {
    const was = before.get(s.key)
    if (!was) changes.push({ kind: s.kind, change: 'added', label: snippet(s) })
    else if (s.kind === 'observation' && was.tagHash !== s.tagHash)
      changes.push({ kind: s.kind, change: 'retagged', label: snippet(s) })
    else if (was.textHash !== s.textHash || was.tagHash !== s.tagHash)
      changes.push({
        kind: s.kind,
        change: s.kind === 'observation' ? 'edited' : 'changed',
        label: snippet(s),
      })
  }
  for (const s of then)
    if (!after.has(s.key)) changes.push({ kind: s.kind, change: 'deleted', label: snippet(s) })
  return changes
}

/** Returns the changes as one sentence, e.g. "2 observations added, 1 retagged and 1 draft finding changed". */
export function changesLine(changes: readonly SourceChange[]): string {
  const observations = (change: SourceChange['change']) =>
    changes.filter((c) => c.kind === 'observation' && c.change === change).length
  const drafted = changes.filter((c) => c.kind !== 'observation').length
  const parts: string[] = []
  const said = (n: number, verb: string) => {
    if (!n) return
    parts.push(parts.length ? `${n} ${verb}` : `${plural(n, 'observation')} ${verb}`)
  }
  said(observations('added'), 'added')
  said(observations('deleted'), 'deleted')
  said(observations('retagged'), 'retagged')
  said(observations('edited'), 'edited')
  if (drafted) parts.push(`${plural(drafted, 'draft finding')} changed`)
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : (parts[0] ?? '')
}

// ---- Compare again ---------------------------------------------------------

/**
 * Returns the decisions Compare again keeps, copied onto the new comparison,
 * and the items it flags for another look. A decision is kept when the item
 * is still there and every current source it rests on reads and is tagged as
 * when it was decided; otherwise the item is flagged, as is any other item
 * whose evidence changed since the last run.
 */
export function carryDecisions(
  last: Comparison & { _id: unknown },
  itemsNow: readonly { key: string }[],
  sourcesNow: readonly ICurrentSource[],
): { decisions: IComparisonDecision[]; recheck: { item: string; reason: string }[] } {
  const now = new Map(sourcesNow.map((s) => [s.key, s]))
  const then = new Map(last.sources.map((s) => [s.key, s]))
  const keysNow = new Set([...itemsNow.map((i) => i.key), ...sourcesNow.map((s) => `N:${s.key}`)])
  const { items } = foldComparison(last)
  const changedOf = (keys: string[]) =>
    keys.filter((k) => {
      const a = then.get(k)
      const b = now.get(k)
      return !a || !b || a.textHash !== b.textHash || a.tagHash !== b.tagHash
    })
  const reasonFor = (changed: string[]) => {
    const gone = changed.filter((k) => !now.has(k)).length
    return gone === changed.length
      ? `${plural(gone, 'source')} it was compared with ${gone === 1 ? 'is' : 'are'} no longer in this assessment.`
      : 'The evidence it was compared with changed since the last comparison.'
  }
  const decisions: IComparisonDecision[] = []
  const recheck: { item: string; reason: string }[] = []
  for (const item of items) {
    const changed = changedOf(item.sources)
    const made = last.decisions.filter((d) => d.item === item.key)
    const d = made.filter(isChoice).at(-1)
    if (made.length && keysNow.has(item.key) && !changed.length) {
      // Its whole history, so it reads as it did, with who decided and when.
      for (const m of made)
        decisions.push({
          ...m,
          carriedFrom: (m.carriedFrom ?? last._id) as IComparisonDecision['carriedFrom'],
        })
      continue
    }
    if (made.length && !keysNow.has(item.key)) continue
    if (d || changed.length)
      recheck.push({
        item: item.key,
        reason: d
          ? `You decided this before its evidence changed. ${reasonFor(changed)}`
          : reasonFor(changed),
      })
  }
  return { decisions, recheck }
}
