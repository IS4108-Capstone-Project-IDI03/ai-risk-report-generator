// Page breaks for the report in Marsh's page layout (RV-12 AC6, AC8), worked
// out from where each block of the report would sit with no page breaks at
// all. The report is never split mid-block: a block that does not fit at the
// bottom of a page moves whole to the next one, pushed down by the space this
// returns. Pure, so the rules are tested without a browser (paginate.test.ts);
// measure.ts measures the blocks and applies the space.
import { contentBottomOf, contentTopOf, snap, type PageGeometry } from './geometry'

// One block of the report that a page can start at.
export type LayoutUnit = {
  // Where it sits with no page breaks, from the top of the text column.
  top: number
  bottom: number
  // Always starts a page: a report section, a Section 5 loss level.
  breakBefore?: boolean
  // Kept on the page of the block after it: a heading, a table's header.
  keepWithNext?: boolean
  // Blocks with the same group are kept on one page when they fit on one:
  // an OFI record's rows.
  group?: string
  // A table's header or one of its rows. A row that starts a page the
  // table continues on gets the header repeated above it.
  table?: string
  header?: boolean
}

// A table header repeated at the top of a page.
export type RepeatedHeader = { table: string; top: number; height: number }

export type Pagination = {
  pages: number
  // The space added above each block to move it to the next page, or 0.
  pushes: number[]
  // The page each block starts on, from 0.
  pageOf: number[]
  // Where the text ends on each page, measured from the first page's top
  // edge: the rest of the page down to its footer is left blank.
  ends: number[]
  // The table header repeated at the top of each page, if any.
  repeats: (RepeatedHeader | null)[]
  // Blocks taller than a page's text area, which run past it.
  overflows: number[]
}

const EPSILON = 0.5

// The last block that must share a page with block i, longest first: i and
// the blocks it is kept with, then any group starting among them; then
// without the groups; then i alone.
function spans(units: LayoutUnit[], i: number): number[] {
  let chain = i
  while (chain + 1 < units.length && units[chain].keepWithNext && !units[chain + 1].breakBefore)
    chain += 1
  let grouped = chain
  for (let k = i; k <= grouped; k += 1) {
    const group = units[k].group
    const starts = group && (k === 0 || units[k - 1].group !== group)
    if (!starts) continue
    let last = k
    while (last + 1 < units.length && units[last + 1].group === group) last += 1
    grouped = Math.max(grouped, last)
  }
  return [...new Set([grouped, chain, i])]
}

export function paginate(units: LayoutUnit[], geometry: PageGeometry): Pagination {
  const pushes = units.map(() => 0)
  const pageOf = units.map(() => 0)
  const ends: number[] = []
  const repeats: (RepeatedHeader | null)[] = [null]
  const overflows: number[] = []
  const headerHeight = new Map<string, number>()
  // How far the blocks have moved down from where they would sit, the text
  // column starting at the first page's text area.
  let shift = geometry.contentTop
  let page = 0
  // Whether the current page has anything on it yet.
  let used = false

  units.forEach((unit, i) => {
    const top = unit.top + shift
    const bottom = unit.bottom + shift
    const pageBottom = contentBottomOf(geometry, page)
    let breakHere = false
    if (used) {
      if (unit.breakBefore || top > pageBottom + EPSILON) breakHere = true
      else {
        // Kept with what follows when that fits on a page; otherwise kept
        // with less, down to the block alone.
        const end = spans(units, i).find(
          (last) => units[last].bottom - unit.top <= geometry.contentHeight + EPSILON,
        )
        const need = end === undefined ? bottom - top : units[end].bottom - unit.top
        breakHere = top + need > pageBottom + EPSILON
      }
    }
    if (breakHere) {
      ends[page] = top
      const repeat =
        unit.table && !unit.header && headerHeight.has(unit.table)
          ? headerHeight.get(unit.table)!
          : 0
      // The next page whose text area starts at or below this block: only a
      // block running past a page can make it skip one.
      let next = page + 1
      while (contentTopOf(geometry, next) + repeat < top - EPSILON) next += 1
      for (let skipped = page + 1; skipped < next; skipped += 1) {
        ends[skipped] = contentBottomOf(geometry, skipped)
        repeats[skipped] = null
      }
      const push = snap(contentTopOf(geometry, next) + repeat - top)
      pushes[i] = push
      shift += push
      repeats[next] = repeat
        ? { table: unit.table!, top: contentTopOf(geometry, next), height: repeat }
        : null
      page = next
    }
    pageOf[i] = page
    used = true
    if (unit.table && unit.header) headerHeight.set(unit.table, unit.bottom - unit.top)
    if (unit.bottom + shift > contentBottomOf(geometry, page) + EPSILON) overflows.push(i)
  })

  const last = units.at(-1)
  ends[page] = last ? last.bottom + shift : contentTopOf(geometry, page)
  for (let p = 0; p <= page; p += 1) repeats[p] ??= null
  return { pages: page + 1, pushes, pageOf, ends, repeats, overflows }
}
