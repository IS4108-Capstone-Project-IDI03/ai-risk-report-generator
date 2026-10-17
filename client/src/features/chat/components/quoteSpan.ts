// Finds where a citation's quoted words sit in a text (CB-02 AC1, AC2).
// Used by PassageText (passage tab) and PassagePdf (text layer on the PDF page).

// Must match microservices/rag-service/app/chat/quotes.py `quote_found`: the same three
// tiers in the same order, so a quote the server called verified is always found here.
// Tier 1 exact; tier 2 ignores case and whitespace runs; tier 3 also ignores punctuation.
// Tier 3 also drops accent marks, as Python's `[^\w\s]` does.

type Span = [start: number, end: number]

// A text reduced for matching, with where each kept character came from in the original.
type Folded = { text: string; origin: number[] }

/** Lower-cases `text`, folds whitespace runs to one space, optionally drops punctuation. */
function fold(text: string, dropPunctuation: boolean): Folded {
  const kept: string[] = []
  const origin: number[] = []
  let i = 0
  for (const ch of text) {
    const at = i
    i += ch.length
    if (dropPunctuation && /[^\p{L}\p{N}\s]|_/u.test(ch)) continue
    if (/\s/.test(ch)) {
      // A leading space or a second one in a row is dropped, as Python's split/join does.
      if (kept.length === 0 || kept[kept.length - 1] === ' ') continue
      kept.push(' ')
      origin.push(at)
    } else {
      // toLowerCase can yield several characters; each maps back to the same original one.
      for (const low of ch.toLowerCase()) {
        kept.push(low)
        origin.push(at)
      }
    }
  }
  if (kept[kept.length - 1] === ' ') {
    kept.pop()
    origin.pop()
  }
  return { text: kept.join(''), origin }
}

/** Returns the [start, end) of the quote inside the text, in the text's own offsets, or null. */
export function quoteSpan(quote: string, text: string): Span | null {
  if (!quote.trim()) return null
  const exact = text.indexOf(quote)
  if (exact !== -1) return [exact, exact + quote.length]
  for (const dropPunctuation of [false, true]) {
    const q = fold(quote, dropPunctuation).text
    if (!q) continue
    const t = fold(text, dropPunctuation)
    const at = t.text.indexOf(q)
    if (at === -1) continue
    // End is just past the original character the match's last character came from.
    const last = t.origin[at + q.length - 1]
    return [t.origin[at], last + (text.codePointAt(last)! > 0xffff ? 2 : 1)]
  }
  return null
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Returns a function giving each PDF text item's HTML with the span's words in <mark>.
 * `span` is an offset into the items joined with one space, the text the quote was
 * located in. Escaped, because react-pdf's customTextRenderer takes an HTML string.
 */
export function markItems(items: string[], span: Span): (index: number) => string {
  return (index) => {
    const start = items.slice(0, index).reduce((n, s) => n + s.length + 1, 0)
    const str = items[index]
    const from = Math.max(span[0] - start, 0)
    const to = Math.min(span[1] - start, str.length)
    if (from >= to) return escapeHtml(str)
    return `${escapeHtml(str.slice(0, from))}<mark>${escapeHtml(str.slice(from, to))}</mark>${escapeHtml(str.slice(to))}`
  }
}
