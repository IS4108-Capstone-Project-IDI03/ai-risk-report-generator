// The building stack on the Observations tab (CP-61): each building drawn as
// its levels, lowest at the bottom, every location a cell coloured by its
// worst observation, so the engineer sees where the risk sits and which
// locations have nothing recorded. Built on CP-16's grouping (locations.ts);
// drawn by components/BuildingStack.tsx.
import { groupLocations, levelRank, type Place } from './locations'

// A cell's colour: its worst severity; 'unset' when its observations have no
// severity yet; 'empty' when nothing is recorded there; 'nomatch' when it
// holds observations but the filters show none of them.
export type StackTone = 'critical' | 'high' | 'moderate' | 'low' | 'unset' | 'empty' | 'nomatch'

const RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1 }
const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}
export const TONE_LABEL: Record<StackTone, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  unset: 'No severity yet',
  empty: 'Nothing recorded',
  nomatch: 'No match',
}

/** Returns the worst severity among the observations, or '' when none has one yet. */
export function worstSeverity(items: readonly { sev: string }[]): string {
  let worst = ''
  for (const { sev } of items) if ((RANK[sev] ?? 0) > (RANK[worst] ?? 0)) worst = sev
  return worst
}

// A location as the stack takes it: the observations the filters show there,
// and how many it holds in all (deleted ones never counted).
export type StackLocation = Place & {
  id: string
  items: readonly { sev: string }[]
  total: number
}

export type StackCell<L> = {
  location: L
  // Its building (or Elsewhere on site, Building not recorded) and its level,
  // null for the whole building or elsewhere on site.
  group: string
  level: string | null
  tone: StackTone
  // The worst severity shown, '' when none.
  worst: string
  shown: number
  total: number
}
export type StackFloor<L> = {
  title: string
  // The whole building's strip, a level above ground, the lowest of those
  // (the ground line runs under it), or a level below ground.
  kind: 'whole' | 'above' | 'ground' | 'below'
  // Its row in the site's grid, so ground floors line up across buildings.
  row: number
  cells: StackCell<L>[]
}
export type StackBuilding<L> = {
  key: string
  title: string
  // Top to bottom, as drawn.
  floors: StackFloor<L>[]
  // The row its name sits in, just above its top floor.
  headRow: number
  // The most locations on one of its floors: how wide it is drawn.
  span: number
  // Observations shown in it.
  shown: number
}
export type Stack<L> = {
  buildings: StackBuilding<L>[]
  elsewhere: StackCell<L>[]
  // Every cell in CP-16's order (building, level lowest first, name), for the table.
  cells: StackCell<L>[]
}

function cellOf<L extends StackLocation>(
  location: L,
  group: string,
  level: string | null,
): StackCell<L> {
  const shown = location.items.length
  const worst = worstSeverity(location.items)
  const tone: StackTone = !location.total
    ? 'empty'
    : !shown
      ? 'nomatch'
      : ((worst || 'unset') as StackTone)
  return { location, group, level, tone, worst, shown, total: location.total }
}

/**
 * Returns the site as stacks: each building's floors top to bottom with a
 * cell per location, the locations elsewhere on site, and every cell in
 * CP-16's order. A building with levels but no name ("Building not
 * recorded") is drawn as a building too.
 */
export function buildingStack<L extends StackLocation>(locations: L[]): Stack<L> {
  const cells: StackCell<L>[] = []
  const elsewhere: StackCell<L>[] = []
  const drafts: { key: string; title: string; floors: Omit<StackFloor<L>, 'row'>[] }[] = []
  for (const g of groupLocations(locations)) {
    // groupLocations lists the whole building first, then levels lowest first.
    const levels = g.levels.map((level) => {
      const whole = !level.locations[0]?.floor
      const title = level.title ?? ''
      const row = level.locations.map((l) => cellOf(l, g.title, whole ? null : title))
      cells.push(...row)
      return { title, whole, cells: row }
    })
    if (g.key === 'elsewhere') {
      elsewhere.push(...levels.flatMap((level) => level.cells))
      continue
    }
    const below = (title: string) => (levelRank(title) ?? 0) < 0
    const strip = levels.filter((level) => level.whole)
    // Highest first: a level it doesn't recognise (Podium) goes above the rest.
    const rest = levels.filter((level) => !level.whole).reverse()
    const floors: Omit<StackFloor<L>, 'row'>[] = [...strip, ...rest].map((level) => ({
      title: level.title,
      kind: level.whole ? 'whole' : below(level.title) ? 'below' : 'above',
      cells: level.cells,
    }))
    // The ground line runs under the lowest level that is not below ground.
    const ground = [...floors].reverse().find((f) => f.kind === 'above')
    if (ground) ground.kind = 'ground'
    drafts.push({ key: g.key, title: g.title, floors })
  }
  const aboveOf = (floors: { kind: string }[]) => floors.filter((f) => f.kind !== 'below').length
  const tallest = Math.max(0, ...drafts.map((b) => aboveOf(b.floors)))
  const buildings = drafts.map((b) => {
    // Row 1 holds the tallest building's name; a shorter one starts lower.
    const headRow = 1 + tallest - aboveOf(b.floors)
    return {
      key: b.key,
      title: b.title,
      headRow,
      floors: b.floors.map((f, i) => ({ ...f, row: headRow + 1 + i })),
      span: Math.max(1, ...b.floors.map((f) => f.cells.length)),
      shown: b.floors.reduce((n, f) => n + f.cells.reduce((m, c) => m + c.shown, 0), 0),
    }
  })
  return { buildings, elsewhere, cells }
}

/** Returns the words in a cell under its name: "4 · Critical", "0 of 3" or "Nothing recorded". */
export function cellLine(cell: StackCell<unknown>): string {
  if (cell.tone === 'empty') return 'Nothing recorded'
  if (cell.tone === 'nomatch') return `0 of ${cell.total}`
  return `${cell.shown} · ${cell.worst ? SEVERITY_LABEL[cell.worst] : 'No severity'}`
}

const count = (n: number) => `${n} observation${n === 1 ? '' : 's'}`

/** Returns what a cell holds in words, for a screen reader, the panel and the table. */
export function cellSummary(cell: StackCell<unknown>): string {
  if (cell.tone === 'empty') return 'Nothing recorded'
  if (cell.tone === 'nomatch')
    return `None of its ${count(cell.total)} match${cell.total === 1 ? 'es' : ''} the filters`
  const held = cell.shown < cell.total ? `${cell.shown} of ${count(cell.total)}` : count(cell.shown)
  return `${held}, ${cell.worst ? 'worst ' + SEVERITY_LABEL[cell.worst] : 'no severity yet'}`
}

/** Returns where a cell is, general to specific without its name: "Block A › Ground". */
export const cellWhere = (cell: StackCell<unknown>) =>
  [cell.group, cell.level].filter(Boolean).join(' › ')

const KEY: StackTone[] = ['critical', 'high', 'moderate', 'low', 'unset', 'empty']

/** Returns the key under the toolbar: each colour, its name and how many locations wear it. */
export function stackKey(cells: StackCell<unknown>[]) {
  const tones = cells.some((c) => c.tone === 'nomatch') ? [...KEY, 'nomatch' as const] : KEY
  return tones.map((tone) => ({
    tone,
    label: TONE_LABEL[tone],
    count: cells.filter((c) => c.tone === tone).length,
  }))
}
