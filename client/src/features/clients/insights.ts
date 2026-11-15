// What the Insights tab (CP-29) works out in the browser from the gateway's
// figures: a grid cell's shade and wording, and each site's change between
// visits for the measure chosen. No counting is done here: the gateway counts.
// Used by components/FindingsGrid.tsx and components/VisitChange.tsx.
import type { InsightCell, InsightSite, InsightTone, InsightVisit } from './api'
import { plural } from './formatClient'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthOf = (day: string | null) =>
  day ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` : null

/** Returns a category's name as the grid heads it. */
export const categoryName = (category: string | null) => category ?? 'Uncategorised'

/** Returns a cell's shade, 0 (none) to 7 (the most in the grid). */
export function heatStep(count: number, max: number): number {
  if (!count || !max) return 0
  return Math.max(1, Math.ceil((count / max) * 7))
}

/** Returns what a cell holds, in words: its count and how severe. */
export function cellText(site: string, cell: InsightCell): string {
  const head = `${site} · ${categoryName(cell.category)}: `
  if (!cell.count) return head + 'no observations.'
  if (!cell.category)
    return head + `${plural(cell.count, 'observation')} not yet categorised, left out of drafting.`
  const rest = cell.count - cell.critical - cell.high
  return (
    head +
    `${plural(cell.count, 'observation')} (${cell.critical} Critical, ${cell.high} High, ${rest} Moderate or Low).`
  )
}

// What the change between visits is measured in.
export type Measure = 'severity' | 'ofis' | 'score'
export const MEASURES: { value: Measure; label: string }[] = [
  { value: 'severity', label: 'Critical and High' },
  { value: 'ofis', label: 'Accepted OFIs' },
  { value: 'score', label: 'Risk quality score' },
]

const valueOf = (visit: InsightVisit, measure: Measure): number | null =>
  measure === 'severity' ? visit.criticalHigh : measure === 'ofis' ? visit.ofis : visit.score

/** Returns the axis for a measure: its top, and three ticks. A score is out of 100. */
export function changeScale(sites: InsightSite[], measure: Measure) {
  const values = sites.flatMap((s) => s.visits.map((v) => valueOf(v, measure) ?? 0))
  // An even top of at least 4, so the middle tick is a whole number.
  const max = measure === 'score' ? 100 : Math.max(4, Math.ceil(Math.max(0, ...values) / 2) * 2)
  return { max, ticks: [0, max / 2, max] }
}

export type ChangePoint = { at: number; kind: 'first' | 'middle' | 'latest'; label: string }
export type ChangeRow = {
  id: string
  name: string
  // "Mar 2025 to Sep 2026", one month for a single visit, or null without dates.
  period: string | null
  // Each visit with a value, placed along the axis as a share of its top (0 to 1).
  points: ChangePoint[]
  // The bar between the first and latest visit, as shares of the axis.
  span: { from: number; width: number } | null
  // "5 → 7", "3" for one visit, or a dash.
  values: string
  chip: { text: string; tone: InsightTone }
  // The row in words, for a screen reader.
  label: string
}

/** Returns each site's first and latest value for the measure, and how it moved. */
export function changeRows(sites: InsightSite[], measure: Measure, max: number): ChangeRow[] {
  const name = MEASURES.find((m) => m.value === measure)!.label
  return sites.map((site) => {
    const visits = site.visits.filter((v) => valueOf(v, measure) !== null)
    const first = visits[0]
    const latest = visits[visits.length - 1]
    const a = first ? valueOf(first, measure)! : null
    const b = latest ? valueOf(latest, measure)! : null
    const repeat = visits.length > 1

    let chip: ChangeRow['chip'] = { text: 'First visit', tone: 'neutral' }
    if (!site.visits.length) chip = { text: 'No observations yet', tone: 'neutral' }
    else if (b === null) chip = { text: 'Not entered', tone: 'neutral' }
    else if (repeat && a === b) chip = { text: 'No change', tone: 'neutral' }
    else if (repeat && measure === 'ofis')
      // More recommendations at a resurvey is not clearly worse, so it is not judged.
      chip = { text: `${Math.abs(b - a!)} ${b > a! ? 'more' : 'fewer'}`, tone: 'neutral' }
    else if (repeat) {
      const improved = measure === 'severity' ? b < a! : b > a!
      chip = improved ? { text: 'Improved', tone: 'good' } : { text: 'Worse', tone: 'danger' }
    }

    const from = monthOf(first?.siteVisitDate ?? null)
    const to = monthOf(latest?.siteVisitDate ?? null)
    const values = b === null ? '–' : repeat ? `${a} → ${b}` : String(b)
    return {
      id: site.id,
      name: site.name,
      period: repeat && from && to ? `${from} to ${to}` : to,
      points: visits.map((v, i) => ({
        at: valueOf(v, measure)! / max,
        kind: i === visits.length - 1 ? 'latest' : i === 0 ? 'first' : 'middle',
        label: `${monthOf(v.siteVisitDate) ?? v.reference}: ${valueOf(v, measure)}`,
      })),
      span: repeat ? { from: Math.min(a!, b!) / max, width: Math.abs(b! - a!) / max } : null,
      values,
      chip,
      label:
        `${site.name}, ${name}: ` +
        (b === null
          ? chip.text.toLowerCase()
          : repeat
            ? `${a} at the first visit, ${b} at the latest. ${chip.text}`
            : `${b} at its first visit`) +
        '.',
    }
  })
}
