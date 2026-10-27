// Tests for the PDF tab's highlight geometry (CB-02 AC2): one rectangle per line the quote
// covers, never taller than the gap to the next line.
import { describe, expect, it } from 'vitest'
import { quoteRects, type PdfText } from './quoteRects'

// Two lines of one column, baselines 12pt apart, and a line in a second column.
const line = (str: string, y: number, height = 10, x = 100, page = 1): PdfText => ({
  str,
  page,
  x,
  y,
  width: str.length * 5,
  height,
})
const PAGE = [
  line('Visually inspect', 700),
  line('indicating control valves.', 688),
  line('Other column text', 694, 10, 400),
]

describe('quoteRects', () => {
  it('gives one rectangle per line, spanning only the quoted characters', () => {
    expect(quoteRects(PAGE, 'inspect indicating')).toEqual([
      { page: 1, l: 145, r: 180, t: 708, b: 698 },
      { page: 1, l: 100, r: 150, t: 696, b: 686 },
    ])
  })

  it('caps a tall font at just under the line gap, so lines never overlap', () => {
    const tall = PAGE.map((t) => ({ ...t, height: 20 }))
    const [first, second] = quoteRects(tall, 'inspect indicating')
    // 95% of the 12pt gap: 11.4pt, 80% above the baseline and 20% below.
    expect(first.t).toBeCloseTo(709.12)
    expect(first.b).toBeCloseTo(697.72)
    expect(second.t).toBeLessThan(first.b)
  })

  it('finds a quote whose word pdf.js split over two lines', () => {
    const split = [line('the flow and measure', 700), line('ment of water', 688)]
    // "measure" is characters 13-20 of line 1 (5pt each); line 2 is all quoted.
    expect(quoteRects(split, 'measurement of water')).toEqual([
      { page: 1, l: 165, r: 200, t: 708, b: 698 },
      { page: 1, l: 100, r: 165, t: 696, b: 686 },
    ])
  })

  it('finds a quote over ligatures and superscripts the PDF keeps as one character', () => {
    // pdf.js gives "ﬁ" (one glyph) where the passage text, and so the quote, says "fi".
    const page = [line('Many new deﬁnitions over 4000 ft²', 700)]
    expect(quoteRects(page, 'new definitions over 4000 ft2')).toHaveLength(1)
  })

  it('finds a quote that runs over a page break, a rectangle on each page', () => {
    // A passage over pages 7 and 8: the last line of page 7, then the first line of page 8.
    const pages = [
      line('the static and residual', 60, 10, 100, 7),
      line('pressures from', 740, 10, 100, 8),
    ]
    const rects = quoteRects(pages, 'residual pressures')
    expect(rects.map((r) => r.page)).toEqual([7, 8])
  })

  it("doesn't let another page's lines shrink a highlight", () => {
    // Page 8's line sits 5pt from page 7's on paper, but on another page: no cap.
    const pages = [line('Visually inspect', 700, 10, 100, 7), line('valves', 695, 10, 100, 8)]
    const [rect] = quoteRects(pages, 'Visually inspect')
    expect(rect.t - rect.b).toBe(10)
  })

  it("finds a table row's quote although it names columns the PDF does not show", () => {
    // Ingestion turns a row into "Column: value; Column: value" (table_text.py); the PDF page
    // shows only the values, one cell per text item.
    const table = [
      line('Test a random sample of dry-type sprin-', 700),
      line('klers (AKA dry pendent)', 688),
      line('Every 15 years', 676),
    ]
    const quote =
      'Test a random sample of dry-type sprinklers (AKA dry pendent); Frequency: Every 15 years'
    expect(quoteRects(table, quote)).toHaveLength(3)
  })

  it('still gives nothing for a labelled quote whose words are not on the page', () => {
    expect(quoteRects(PAGE, 'Frequency: Every 15 years')).toEqual([])
  })

  it('gives nothing when the quote is not on the page', () => {
    expect(quoteRects(PAGE, 'replace the valve monthly')).toEqual([])
  })
})
