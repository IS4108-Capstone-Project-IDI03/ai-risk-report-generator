// What the Passages dialog (IN-17) knows about its table: the filters and how they read, the
// words on each row, and the labels in the chapter and section dropdowns. Used by
// components/PassagesDialog.tsx, PassageFilters.tsx and PassageRow.tsx.
import type { DocumentPassage, OutlineEntry, PassageListing, PassageQuery, SearchMode } from './api'

export const PAGE_SIZE = 25

export const KINDS: Record<DocumentPassage['kind'], string> = {
  text: 'Text',
  table: 'Table',
  formula: 'Formula',
  picture: 'Picture',
}

// What the table is narrowed to: words to search for, the outline's chapter and section
// (undefined is all of them), and the page range as typed (a blank or unusable page
// leaves that end open).
export type Filters = {
  words: string
  chapter?: string
  section?: string
  from: string
  to: string
}
export const NO_FILTERS: Filters = { words: '', from: '', to: '' }
// Whether anything narrows the table: a typed page, words, or a chapter or section.
export const narrowed = (f: Filters) =>
  f.chapter !== undefined || f.section !== undefined || !!(f.words.trim() || f.from || f.to)
// How long typing must pause before the words are searched.
export const SEARCH_PAUSE_MS = 300
export const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: 'words', label: 'Words' },
  { value: 'meaning', label: 'Meaning' },
]

// "14", "12–13", or "—" when the passage has no page.
export function pages(p: DocumentPassage): string {
  if (p.pageStart == null) return '—'
  if (p.pageEnd == null || p.pageEnd === p.pageStart) return String(p.pageStart)
  return `${p.pageStart}–${p.pageEnd}`
}

// "Passages 26–50 of 1,214": which of the matching passages this page shows. A search by
// meaning names its question, as the rows answer it rather than contain its words.
export function shown(offset: number, listing: PassageListing, query: PassageQuery): string {
  const last = offset + listing.passages.length
  const of = listing.total.toLocaleString('en')
  const range = `Passages ${(offset + 1).toLocaleString('en')}–${last.toLocaleString('en')} of ${of}`
  return query.mode === 'meaning' ? `${range} matching “${query.q}”` : range
}

// A chapter as the filter names it: "Chapter 8", "Annex A", "Front matter". A past
// report's chapters are its template sections, named as they are.
export function chapterName(name: string, byClause: boolean): string {
  if (!byClause) return name || 'No section'
  if (!name) return 'Front matter'
  return /^\d+$/.test(name) ? `Chapter ${name}` : `Annex ${name}`
}

// "Chapter 8 Installation": a chapter or section with its title, ending at a whole word
// within LABEL_CHARS so a dropdown doesn't grow to a paragraph.
const LABEL_CHARS = 60
export function named(name: string, title: string | null): string {
  const full = title ? `${name} ${title}` : name
  if (full.length <= LABEL_CHARS) return full
  const cut = full.slice(0, LABEL_CHARS)
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`
}

// The chosen chapter's sections; "" is its start, before the first numbered section.
export function sectionOptions(sections: OutlineEntry[]) {
  return sections.map((s) => ({
    value: `s:${s.name}`,
    label: `${named(s.name || 'Chapter start', s.title)} (${s.count.toLocaleString('en')})`,
  }))
}

// A typed page number, or undefined when blank or not a page (0, -2, 1.5).
export function pageNumber(text: string): number | undefined {
  const page = Number(text)
  return text.trim() && Number.isInteger(page) && page >= 1 ? page : undefined
}
