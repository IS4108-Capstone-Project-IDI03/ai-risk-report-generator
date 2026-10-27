// Where to draw the quoted words on the PDF (CB-02 AC2): a rectangle per text line the quote
// covers, on whichever of the passage's pages it falls (a passage, and a quote, can run over a
// page break), in PDF points with the origin bottom-left, like the passage boxes.
// Used by PdfViewer. Drawn by us, not by marking pdf.js's text layer: some PDFs report a
// font twice the printed size, and the text layer's spans then cover two lines.
import { quoteSpan } from './quoteSpan'

/** One pdf.js text item: its page, text, baseline start (x, y), width and font height. */
export type PdfText = {
  page: number
  str: string
  x: number
  y: number
  width: number
  height: number
}

export type Rect = { l: number; r: number; t: number; b: number }
export type PageRect = Rect & { page: number }

// A line's ink sits about 80% above its baseline and 20% below.
const ASCENT = 0.8

/** Returns the rectangles covering the quote's characters, or [] when it isn't in the items. */
// `pdfItems` are the passage's pages' items in page order, so the joined text runs on across
// a page break as the passage does.
export function quoteRects(pdfItems: PdfText[], quote: string): PageRect[] {
  // NFKC spells out what a PDF keeps as one character ("ﬁ" as "fi", "²" as "2"), as the
  // passage text the quote came from does. Widths stay per item, so offsets still line up.
  const items = pdfItems.map((t) => ({ ...t, str: t.str.normalize('NFKC') }))
  // Located in the items joined by one space, as the page's text reads.
  const page = items.map((t) => t.str).join(' ')
  const wanted = quote.normalize('NFKC')
  // A table row's passage reads "Column: value; Column: value" (ingestion table_text.py), but the
  // PDF shows only the values; so when the quote is not found as written, it is tried again with
  // the column labels taken out.
  const unlabelled = wanted.replace(/(^|;)\s*[^;:]{1,40}:\s/g, ' ')
  const span =
    quoteSpan(wanted, page, { acrossLineBreaks: true }) ??
    quoteSpan(unlabelled, page, { acrossLineBreaks: true })
  if (!span) return []
  const rects: PageRect[] = []
  let start = 0
  for (const item of items) {
    const from = Math.max(span[0] - start, 0)
    const to = Math.min(span[1] - start, item.str.length)
    start += item.str.length + 1
    if (from >= to) continue
    // Characters are taken as equal widths: pdf.js gives an item's width, not each glyph's.
    const perChar = item.width / item.str.length
    const height = Math.min(item.height, 0.95 * lineGap(item, items))
    rects.push({
      page: item.page,
      l: item.x + from * perChar,
      r: item.x + to * perChar,
      t: item.y + ASCENT * height,
      b: item.y - (1 - ASCENT) * height,
    })
  }
  return rects
}

// The distance to the nearest baseline above or below on the same page that shares some of the
// item's width (so the next column's and the next page's lines don't count). Infinity for a
// line on its own.
function lineGap(item: PdfText, items: PdfText[]): number {
  let gap = Infinity
  for (const other of items) {
    const dy = Math.abs(other.y - item.y)
    const overlaps = other.x < item.x + item.width && item.x < other.x + other.width
    if (other.page === item.page && overlaps && dy > 0.3 * item.height) gap = Math.min(gap, dy)
  }
  return gap
}
