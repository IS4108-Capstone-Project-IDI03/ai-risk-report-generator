// The pieces MarshBot's cards are made of (AS-06 round 5): a row from an item,
// the row endings, area icons and ticks. Called by the topic builders in thread/.
// Cards are terse: a row is a name and one short status (rule 3).
import { dayOf, daysBetween } from '../dates'
import { STAGE_LABELS } from '../stage'
import {
  STAGES,
  type BriefItem,
  type CardRow,
  type ItemLink,
  type Stage,
  type TickCell,
} from '../types'

const TAB_NAMES: Record<ItemLink['tab'], string> = {
  overview: 'Details',
  checklist: 'Checklist',
  observations: 'Observations',
  generate: 'Generation',
  review: 'Review',
  export: 'Export',
}

/** Returns a round-arrow ending that opens `link`, with "Open in <tab>" as its tooltip. */
export const opens = (link: ItemLink): CardRow['end'] => ({
  type: 'open',
  link,
  label: `Open in ${TAB_NAMES[link.tab]}`,
})

/** Returns a row. */
export function row(
  id: string,
  icon: string,
  tone: CardRow['tone'],
  title: string,
  detail: string | null,
  end: CardRow['end'],
  extra: Partial<Pick<CardRow, 'bad' | 'quote'>> = {},
): CardRow {
  return { id, icon, tone, title, detail, bad: false, quote: null, end, ...extra }
}

/** Returns an item as a plain row: amber for a gap, ending in an arrow to its link (or a tick). */
export function itemRow(item: BriefItem): CardRow {
  return row(
    item.id,
    item.icon,
    item.weight === 'info' ? 'neutral' : 'amber',
    item.title,
    item.detail,
    item.link ? opens(item.link) : { type: 'tick' },
  )
}

/** Returns a green-ticked row: a thing that is fine. */
export const tickRow = (id: string, icon: string, title: string, detail: string | null) =>
  row(id, icon, 'green', title, detail, { type: 'tick' })

/** Returns a tick cell. */
export const tick = (
  title: string,
  detail: string | null,
  bar: TickCell['bar'] = null,
): TickCell => ({ title, detail, bar })

// Each checklist area's icon, as on the boards (lucide names).
const AREA_ICONS: Record<string, string> = {
  'External Exposures': 'cloud-lightning',
  'Fire Protection': 'flame',
  Security: 'shield',
  'Management Programs': 'clipboard-check',
  'Occupancy and Hazards': 'factory',
  Construction: 'hard-hat',
}
/** Returns a checklist area's icon. */
export const areaIcon = (area: string) => AREA_ICONS[area] ?? 'layout-list'

/** Returns "1 thing" or "3 things", with digits (rule 3). */
export const count = (n: number, what: string, many = `${what}s`) => `${n} ${n === 1 ? what : many}`

/** Returns "A", "A and B", or "A, B, and C" for clauses MarshBot strings together. */
export function andList(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts.at(-1)}`
}

/** Returns a test for items of these kinds. */
export const kinds =
  (...names: string[]) =>
  (i: { kind: string }) =>
    names.includes(i.kind)

/** Returns the text when it fits the rail's status pill (18 characters; longer is cut off in the 272px rail), else the shorter one. */
export const pill = (text: string, short: string) => (text.length <= 18 ? text : short)

/** Returns the text with its first letter in lower case ("Morning walk" -> "morning walk"). */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
/** Returns the text with its first letter in upper case. */
export const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Returns the days spent in each stage reached so far, in order; the current one runs to
 * `today` and is marked `now`. A stage the assessment jumped over is `skipped`: advanceStage
 * (stage.ts) dates every stage passed in one move with the same instant, so a stage dated the
 * same instant as the next one was never worked in. Read by the admin's Time in Each Stage card.
 */
export function stageSpans(
  stageDates: Record<Stage, string | null>,
  stage: Stage,
  today: string,
): { label: string; days: number; now: boolean; skipped?: boolean }[] {
  const reached = STAGES.filter((s) => stageDates[s])
  return reached.map((s, n) => {
    const next = reached[n + 1] ? stageDates[reached[n + 1]]! : null
    const from = dayOf(new Date(stageDates[s]!))
    const to = next ? dayOf(new Date(next)) : today
    return {
      label: STAGE_LABELS[s],
      days: Math.max(0, daysBetween(from, to)),
      now: s === stage,
      ...(next && Date.parse(next) === Date.parse(stageDates[s]!) ? { skipped: true } : {}),
    }
  })
}
