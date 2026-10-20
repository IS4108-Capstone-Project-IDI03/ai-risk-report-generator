// The data behind the report's charts (GN-12): Section 3's OFI counts and Section 4's
// risk quality series, shaped from what Review already loads. Drawn by
// components/OfiCharts.tsx and RiskQualityCharts.tsx. No AI: counts and the engineer's scores.
import type { AcceptedOfi, RiskQuality } from './api'

export type Count = { label: string; value: number }

// The charts' categorical colours (--chart-* tokens, design-system/tokens/colors.css), in a
// fixed order, so a value keeps its colour between reports. Never red, amber, green or
// violet: those mean severity, review state and AI.
export const SERIES = [
  'var(--chart-blue)',
  'var(--chart-aqua-dark)',
  'var(--chart-orange-dark)',
  'var(--chart-magenta-dark)',
  'var(--chart-olive)',
  'var(--chart-aqua-light)',
  'var(--chart-orange-light)',
  'var(--chart-magenta-light)',
]

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
  return {
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
