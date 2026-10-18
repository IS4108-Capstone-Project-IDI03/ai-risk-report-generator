// Finds where a citation's quoted words sit in a text (CB-02 AC1, AC2).
// Used by PassageText (passage tab) and quoteRects (highlight on the PDF page).

// Must match microservices/rag-service/app/chat/quotes.py `quote_found`: the same three
// tiers in the same order, so a quote the server called verified is always found here.
// Tier 1 exact; tier 2 ignores case and whitespace runs; tier 3 also ignores punctuation.
// Tier 3 also drops accent marks, as Python's `[^\w\s]` does.
// The PDF tab adds a looser tier 4 (`acrossLineBreaks`), which the server has no need of.

type Span = [start: number, end: number]

// A text reduced for matching, with where each kept character came from in the original.
type Folded = { text: string; origin: number[] }

/** Lower-cases `text`, folds whitespace runs to one space (or drops them), optionally drops punctuation. */
function fold(text: string, dropPunctuation: boolean, dropSpaces = false): Folded {
  const kept: string[] = []
  const origin: number[] = []
  let i = 0
  for (const ch of text) {
    const at = i
    i += ch.length
    if (dropPunctuation && /[^\p{L}\p{N}\s]|_/u.test(ch)) continue
    if (/\s/.test(ch) && dropSpaces) continue
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

// Tier 4: pdf.js drops the hyphen of a word split over two lines, and the page's items are
// joined with a space, so "measurement" reads "measure ment". Ignoring spaces finds it; a
// whole quote (up to 25 words) matching with its spaces removed is still unlikely by chance.
type Options = { acrossLineBreaks?: boolean }

/** Returns the [start, end) of the quote inside the text, in the text's own offsets, or null. */
export function quoteSpan(quote: string, text: string, options: Options = {}): Span | null {
  if (!quote.trim()) return null
  const exact = text.indexOf(quote)
  if (exact !== -1) return [exact, exact + quote.length]
  // [dropPunctuation, dropSpaces] for tiers 2, 3 and (PDF only) 4.
  const tiers = [[false, false], [true, false], ...(options.acrossLineBreaks ? [[true, true]] : [])]
  for (const [dropPunctuation, dropSpaces] of tiers) {
    const q = fold(quote, dropPunctuation, dropSpaces).text
    if (!q) continue
    const t = fold(text, dropPunctuation, dropSpaces)
    const at = t.text.indexOf(q)
    if (at === -1) continue
    // End is just past the original character the match's last character came from.
    const last = t.origin[at + q.length - 1]
    return [t.origin[at], last + (text.codePointAt(last)! > 0xffff ? 2 : 1)]
  }
  return null
}
