// Searching an assessment's evidence text (CP-13): voice transcripts,
// handwritten page transcripts and photo descriptions, on All Recordings, All
// Handwritten Pages, All Photos and the Observations list. All in the browser,
// on the observations already loaded: nothing is sent anywhere.
//
// A search is its words, in any order: an item matches when every word is in
// its text somewhere, ignoring case and accents ("cafe" finds "Café").
// Positions are in the text as written (UTF-16 units, as JavaScript slices
// strings), so what matched can be marked in place.

export type Range = [number, number]

// What a recording's text says when Whisper heard nothing; not words to find.
export const NO_SPEECH = '(No speech was detected.)'

// The text lowercased, with accents dropped, and the same length as written,
// so a position in one is a position in the other. A character that would
// change length (rare: a ligature, a dotted capital I) is only lowercased if
// that keeps its length, or else kept as it is.
function fold(text: string) {
  let out = ''
  for (const ch of text) {
    const bare = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (bare.length === ch.length) out += bare
    else {
      const lower = ch.toLowerCase()
      out += lower.length === ch.length ? lower : ch
    }
  }
  return out
}

// The search's words, folded, each once. None for a blank search.
export function searchWords(query: string): string[] {
  return [...new Set(fold(query).split(/\s+/).filter(Boolean))]
}

// Whether every word is somewhere in the texts, taken together: one word in
// the transcript and another in the observation's text still match.
export function matchesAll(texts: (string | null | undefined)[], words: readonly string[]) {
  if (!words.length) return true
  const hay = texts
    .filter((t): t is string => !!t)
    .map(fold)
    .join('\n')
  return words.every((w) => hay.includes(w))
}

// Where any of the words are in the text, in order, overlapping ones joined.
export function hitRanges(text: string, words: readonly string[]): Range[] {
  if (!words.length || !text) return []
  const hay = fold(text)
  const found: Range[] = []
  for (const w of words)
    for (let at = hay.indexOf(w); at !== -1; at = hay.indexOf(w, at + 1))
      found.push([at, at + w.length])
  found.sort((a, b) => a[0] - b[0])
  const joined: Range[] = []
  for (const r of found) {
    const last = joined[joined.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else joined.push([...r])
  }
  return joined
}

// Whether any of the words are in the text: what a row's text opens for, and
// what "Matched in" names.
export const hasHit = (text: string | null | undefined, words: readonly string[]) =>
  !!text && words.length > 0 && hitRanges(text, words).length > 0

// A row of All Photos, All Handwritten Pages or All Recordings, as far as a
// search looks: the observation's text, the item's name and its own text.
type SearchedRow = {
  key: string
  text: string
  name: string
  item?: { searchText?: string | null }
}

// Whether a row holds every word of a search, in its text, name or item text.
export const rowMatches = (r: SearchedRow, words: readonly string[]) =>
  matchesAll([r.text, r.name, r.item?.searchText], words)
// The rows a search found in their own text, whose text opens to show where.
export const textHits = (rows: SearchedRow[], words: readonly string[]) =>
  rows.filter((r) => rowMatches(r, words) && hasHit(r.item?.searchText, words)).map((r) => r.key)

// "the note", "the note and Recording 2", "the note, Page 1 and Recording 2".
export function andList(items: string[]) {
  if (items.length < 2) return items.join('')
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}
