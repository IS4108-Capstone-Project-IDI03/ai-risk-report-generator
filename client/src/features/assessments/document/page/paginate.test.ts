import { describe, expect, it } from 'vitest'
import { contentTopOf, MARSH_GEOMETRY, roman, type PageGeometry } from './geometry'
import { paginate, type LayoutUnit } from './paginate'

// Page breaks in Marsh's page layout (RV-12 AC6, AC8), on small pages so the
// figures are easy to follow: each page is 100 high with a 10 gap, its text
// area 80 high from 10 below its top edge. Page k's text area starts at 110k + 10.
const SMALL: PageGeometry = { pageHeight: 100, gap: 10, contentTop: 10, contentHeight: 80 }

// Blocks one after another, each with its height and rules.
function column(...blocks: (number | [number, Omit<LayoutUnit, 'top' | 'bottom'>])[]) {
  let y = 0
  return blocks.map((b) => {
    const [height, rules] = typeof b === 'number' ? [b, {}] : b
    const unit = { top: y, bottom: y + height, ...rules }
    y += height
    return unit
  })
}

describe('paginate', () => {
  it('keeps a report that fits on one page on one page', () => {
    const result = paginate(column(20, 30, 30), SMALL)
    expect(result.pages).toBe(1)
    expect(result.pushes).toEqual([0, 0, 0])
    expect(result.ends).toEqual([90])
  })

  it('moves a block that does not fit whole to the next page', () => {
    const result = paginate(column(50, 50), SMALL)
    expect(result.pages).toBe(2)
    // The second block would run from 60 to 110; it starts the next text area.
    expect(result.pushes).toEqual([0, contentTopOf(SMALL, 1) - 60])
    expect(result.pageOf).toEqual([0, 1])
    expect(result.ends[0]).toBe(60)
  })

  it('starts a section on a new page even with room left (Marsh)', () => {
    const result = paginate(column(10, [10, { breakBefore: true }], 10), SMALL)
    expect(result.pageOf).toEqual([0, 1, 1])
    // Nothing above the first section, so it needs no break.
    expect(paginate(column([10, { breakBefore: true }]), SMALL).pushes).toEqual([0])
  })

  it('keeps a heading on the page of the block after it', () => {
    const result = paginate(column(50, [10, { keepWithNext: true }], 30), SMALL)
    expect(result.pageOf).toEqual([0, 1, 1])
    expect(result.pushes[2]).toBe(0)
  })

  it('keeps an OFI record on one page when it fits, with its heading', () => {
    const rows = [1, 2, 3].map(() => [10, { group: 'ofi-1' }] as [number, LayoutUnit])
    const result = paginate(column(50, [10, { keepWithNext: true }], ...rows), SMALL)
    // Heading and rows take 40 and only 30 is left below the first block, so
    // all four move.
    expect(result.pageOf).toEqual([0, 1, 1, 1, 1])
  })

  it('splits a record taller than a page, keeping its heading with its first row', () => {
    const rows = [1, 2, 3, 4].map(() => [25, { group: 'ofi-2' }] as [number, LayoutUnit])
    const result = paginate(column(30, [10, { keepWithNext: true }], ...rows), SMALL)
    // The heading and first row fit below the first block; the second row
    // does not, and the record carries on over the page.
    expect(result.pageOf).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('repeats a table header on the page the table continues on', () => {
    const table = { table: 't1' }
    const result = paginate(
      column(
        30,
        [10, { ...table, header: true, keepWithNext: true }],
        [20, table],
        [20, table],
        [20, table],
      ),
      SMALL,
    )
    // Header at 40-50, rows at 50-70, 70-90 and 90-110: the last row starts
    // page 2 under a repeat of the 10-high header.
    expect(result.pageOf).toEqual([0, 0, 0, 0, 1])
    expect(result.repeats).toEqual([null, { table: 't1', top: contentTopOf(SMALL, 1), height: 10 }])
    expect(result.pushes[4]).toBe(contentTopOf(SMALL, 1) + 10 - 90)
  })

  it('moves a header with the first row, without repeating it', () => {
    const table = { table: 't2' }
    const result = paginate(
      column(70, [5, { ...table, header: true, keepWithNext: true }], [20, table]),
      SMALL,
    )
    expect(result.pageOf).toEqual([0, 1, 1])
    expect(result.repeats).toEqual([null, null])
  })

  it('starts a block taller than a page on a fresh page and lets it run over', () => {
    const result = paginate(column(30, 200, 10), SMALL)
    expect(result.pageOf[1]).toBe(1)
    expect(result.overflows).toEqual([1])
    // The block after it starts below it, never above.
    expect(result.pushes.every((p) => p >= 0)).toBe(true)
    expect(result.pageOf[2]).toBeGreaterThan(1)
  })

  it('fits forty-nine 13pt lines in a Marsh text area (648pt)', () => {
    const lines = Array.from({ length: 60 }, () => 13 * (96 / 72))
    const result = paginate(column(...lines), MARSH_GEOMETRY)
    expect(result.pageOf.filter((p) => p === 0)).toHaveLength(49)
  })
})

describe('roman', () => {
  it('numbers the front matter as Marsh does', () => {
    expect([1, 2, 3, 4, 9, 14].map(roman)).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv'])
  })
})
