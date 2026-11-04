// Marsh's report page (RV-12 AC1), measured from the sample reports Marsh
// supplied (Office Sample 5 - PRE 2026 and Shopping Mall Sample 2 - PRE 2025,
// both Word exports): US Letter, 2.5 cm side margins, 1 inch top and bottom
// margins, the running header half an inch from the top and the footer half an
// inch from the bottom. Sizes are in CSS pixels (96 per inch); pages.css uses
// the same figures in points.

// One point in CSS pixels.
export const PT = 96 / 72

export type PageGeometry = {
  // The page's height, and the grey gap drawn between two pages on screen.
  pageHeight: number
  gap: number
  // Where the text area starts below the page's top edge, and its height.
  contentTop: number
  contentHeight: number
}

export const MARSH_PAGE = {
  width: 612 * PT,
  height: 792 * PT,
  marginX: 70.85 * PT,
  marginTop: 72 * PT,
  marginBottom: 72 * PT,
  headerTop: 36 * PT,
  footerBottom: 28 * PT,
  gap: 24,
} as const

export const MARSH_GEOMETRY: PageGeometry = {
  pageHeight: MARSH_PAGE.height,
  gap: MARSH_PAGE.gap,
  contentTop: MARSH_PAGE.marginTop,
  contentHeight: MARSH_PAGE.height - MARSH_PAGE.marginTop - MARSH_PAGE.marginBottom,
}

// A length as the browser lays it out (in 64ths of a pixel), so the space
// added above a block puts it exactly where the layout wants it and the
// small differences do not add up over a long report.
export const snap = (n: number) => Math.round(n * 64) / 64

// The distance from one page's top edge to the next one's.
export const strideOf = (g: PageGeometry) => g.pageHeight + g.gap
// The top and bottom of page k's text area, from the first page's top edge.
export const contentTopOf = (g: PageGeometry, k: number) => k * strideOf(g) + g.contentTop
export const contentBottomOf = (g: PageGeometry, k: number) => contentTopOf(g, k) + g.contentHeight
// The height of a run of pages, without the gap after the last.
export const pagesHeight = (g: PageGeometry, pages: number) =>
  Math.max(1, pages) * strideOf(g) - g.gap

// Page numbers as Marsh's footers print them: the front matter (after the
// cover) in lower-case roman numerals, the report itself from 1.
export function roman(n: number): string {
  const steps: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let left = Math.max(0, Math.floor(n))
  let out = ''
  for (const [value, numeral] of steps)
    while (left >= value) {
      out += numeral
      left -= value
    }
  return out
}
