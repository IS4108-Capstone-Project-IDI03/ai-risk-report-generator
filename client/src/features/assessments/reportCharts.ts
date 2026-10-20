// The data behind the report's charts (GN-12): Section 3's OFI counts and Section 4's
// risk quality series, shaped from what Review already loads. Drawn by
// components/OfiCharts.tsx and RiskQualityCharts.tsx. No AI: counts and the engineer's scores.
import type { AcceptedOfi, RiskQuality } from './api'

export type Count = { label: string; value: number }

// The charts' colours: Marsh's own, as its reports draw them (--report-* tokens in
// design-system/tokens/colors.css; Miya, 20 Oct). Each value keeps its colour between
// reports. Bars and current scores are navy, potential and client scores sky.
export const NAVY = 'var(--report-navy)'
export const SKY = 'var(--report-sky)'
export const TEAL = 'var(--report-teal)'
// The OFI Count by Status donut's colour per status (template p. 5).
export const STATUS_COLOURS: Record<string, string> = {
  Completed: 'var(--report-green)',
  Open: 'var(--report-sky)',
  'In Progress': 'var(--report-blue)',
  New: 'var(--report-ocean)',
  'No Plans to Complete': 'var(--report-red)',
  Deferred: 'var(--report-slate)',
  'On Hold': 'var(--report-midnight)',
  'Under Review': 'var(--report-teal)',
}
// Priorities in the Risk Assessment Matrix's colours (p. 4), also the priority donut's.
export const PRIORITY_COLOURS: Record<string, string> = {
  'Priority 1': 'var(--report-priority-1)',
  'Priority 2': 'var(--report-priority-2)',
  'Priority 3': 'var(--report-priority-3)',
  'Priority 4': 'var(--report-priority-4)',
}

// Marsh's value lists, in the order the template's charts show them (Shopping Mall
// Sample 2, p. 5). Category and effort must match rag-service generation/ofi.json.
const STATUSES = [
  'Completed',
  'Open',
  'In Progress',
  'New',
  'No Plans to Complete',
  'Deferred',
  'On Hold',
  'Under Review',
]
const CATEGORIES = ['Physical Protection', 'Management Programs', 'Other']
const PRIORITIES = ['Priority 1', 'Priority 2', 'Priority 3', 'Priority 4']
const EFFORTS = [
  'Minor Procedural',
  'Moderate Procedural',
  'Major Procedural',
  'Minor Capital',
  'Moderate Capital',
  'Major Capital',
]

// Every value keeps its place, zeros included, so the charts never shift between reports.
const countBy = (values: string[], ofis: AcceptedOfi[], pick: (o: AcceptedOfi) => string) =>
  values.map((label) => ({ label, value: ofis.filter((o) => pick(o) === label).length }))

// Section 3's four charts. Marsh's category, priority and effort charts leave out
// completed OFIs; the status chart counts them all.
export function ofiCounts(accepted: AcceptedOfi[]) {
  const open = accepted.filter((o) => o.status !== 'Completed')
  return {
    status: countBy(STATUSES, accepted, (o) => o.status),
    category: countBy(CATEGORIES, open, (o) => o.category),
    priority: countBy(PRIORITIES, open, (o) => o.priority),
    effort: countBy(EFFORTS, open, (o) => o.effort),
  }
}

// Section 4's three charts, or null until all fourteen scores give both ratings.
export function riskQualitySeries(figures: RiskQuality) {
  const { current, potential } = figures.result
  if (!current || !potential) return null
  // Shares are of the potential score, as Marsh's donut shows them ("83.0, 96%"). A
  // potential of 0 (every score 0) is all current, never a division by zero.
  const currentPct = potential.score ? Math.round((current.score / potential.score) * 100) : 100
  // RQR Score Benchmarking: the Location Score, then each score the engineer entered
  // (GN-12 AC8); one not entered has no bar.
  const others = [
    { label: 'Client Score', value: figures.benchmarks?.client ?? null },
    { label: 'Occupancy Peer Group Score', value: figures.benchmarks?.peerGroup ?? null },
  ].filter((b): b is { label: string; value: number } => b.value !== null)
  return {
    benchmarks: [{ label: 'Location Score', value: current.score }, ...others],
    share: {
      current: current.score,
      currentPct,
      gap: Math.round((potential.score - current.score) * 10) / 10,
      gapPct: 100 - currentPct,
    },
    categories: figures.categories.map(({ category, current, potential }) => ({
      category,
      current: current ?? 0,
      potential: potential ?? 0,
    })),
  }
}
