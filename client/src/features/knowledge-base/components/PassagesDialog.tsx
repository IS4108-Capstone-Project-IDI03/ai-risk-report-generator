// A document's passages as search holds them (IN-17): a table, one page at a time, in
// reading order, narrowed by chapter and section (from the document's outline) and pages.
// Each row shows the passage's place in the document, its nearest heading, an excerpt,
// what it was read from and its pages; opening it shows the passage in full. Read-only for
// everyone. Opened by screens/KnowledgeDocuments.tsx from a document's details.
import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Icon,
  IconRegistry,
  Input,
  Pagination,
  SearchField,
  SegmentedControl,
  Select,
  TableFooter,
} from '../../../design-system'
import {
  listDocumentPassages,
  type DocumentPassage,
  type KnowledgeDocument,
  type OutlineEntry,
  type PassageListing,
  type PassageQuery,
  type SearchMode,
} from '../api'
import { needsReview } from '../display'
import { CitedRegion } from '../../sources/CitedRegion'
import { PassageBody } from '../../sources/PassageBody'
import { usePassage } from '../../sources/usePassage'

const PAGE_SIZE = 25

const KINDS: Record<DocumentPassage['kind'], string> = {
  text: 'Text',
  table: 'Table',
  formula: 'Formula',
  picture: 'Picture',
}

// What the table is narrowed to: words to search for, the outline's chapter and section
// (undefined is all of them), and the page range as typed (a blank or unusable page
// leaves that end open).
type Filters = { words: string; chapter?: string; section?: string; from: string; to: string }
const NO_FILTERS: Filters = { words: '', from: '', to: '' }
// Whether anything narrows the table: a typed page, words, or a chapter or section.
const narrowed = (f: Filters) =>
  f.chapter !== undefined || f.section !== undefined || !!(f.words.trim() || f.from || f.to)
// How long typing must pause before the words are searched.
const SEARCH_PAUSE_MS = 300
const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: 'words', label: 'Words' },
  { value: 'meaning', label: 'Meaning' },
]

/** Returns the Passages dialog for one document. */
export function PassagesDialog({
  document: d,
  onClose,
}: {
  document: KnowledgeDocument
  onClose: () => void
}) {
  // The last listing loaded, with the query it answers.
  const [loaded, setLoaded] = useState<{ key: string; offset: number; listing: PassageListing }>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  // The one passage opened to its full text, if any.
  const [openId, setOpenId] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)

  const pageFrom = pageNumber(filters.from)
  const pageTo = pageNumber(filters.to)
  const reversed = pageFrom !== undefined && pageTo !== undefined && pageFrom > pageTo
  const { chapter, section } = filters
  // The words searched. By words: what's typed, once typing pauses (so it searches once,
  // not at every key). By meaning, a paid call: only on Enter, or on choosing Meaning with
  // words typed; emptying the box goes back to the document at once. A new search starts
  // on page 1, not while typing.
  const [mode, setMode] = useState<SearchMode>('words')
  const [q, setQ] = useState<string>()
  const words = filters.words.trim() || undefined
  const search = (next: string | undefined) => {
    setQ(next)
    setOffset(0)
  }
  useEffect(() => {
    if (words === q || (mode === 'meaning' && words)) return
    const timer = setTimeout(
      () => {
        setQ(words)
        setOffset(0)
      },
      mode === 'words' ? SEARCH_PAUSE_MS : 0,
    )
    return () => clearTimeout(timer)
  }, [words, q, mode])
  // Typed words a search by meaning hasn't run yet: the field says to press Enter.
  const waiting = mode === 'meaning' && !!words && words !== q
  const key = JSON.stringify({
    offset,
    chapter,
    section,
    pageFrom,
    pageTo,
    q,
    mode: q && mode === 'meaning' ? mode : undefined,
  })

  useEffect(() => {
    if (reversed) return
    const controller = new AbortController()
    const query: PassageQuery = { ...JSON.parse(key), limit: PAGE_SIZE }
    listDocumentPassages(d.id, query, controller.signal).then(
      (listing) => setLoaded({ key, offset: query.offset, listing }),
      () => {
        if (!controller.signal.aborted) setFailed(true)
      },
    )
    return () => controller.abort()
  }, [d.id, key, reversed, attempt])

  const listing = loaded?.listing
  // A new page or filter keeps the last rows, dimmed, until it arrives.
  const stale = loaded !== undefined && loaded.key !== key && !reversed
  const filtered = narrowed(filters)
  // All of a document's passages share its status, so one note says it, not a column.
  const outOfUse = d.withdrawn ? 'is withdrawn' : needsReview(d) ? 'needs review' : null

  // Narrows the table; a new chapter, section or page range goes back to its first page.
  const narrow = (next: Filters) => {
    setFilters(next)
    const { chapter, section, from, to } = filters
    if (
      next.chapter !== chapter ||
      next.section !== section ||
      next.from !== from ||
      next.to !== to
    )
      setOffset(0)
  }

  return (
    <Dialog
      className="ds-dialog--v2 ds-dialog-sheet"
      title="Passages"
      description={d.edition ? `${d.title} · ${d.edition}` : d.title}
      width={1040}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {failed ? (
        <Callout
          tone="danger"
          title="Passages not loaded"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          }
        >
          The knowledge base could not be reached. Try again shortly.
        </Callout>
      ) : !listing ? (
        <LoadingRows />
      ) : listing.total === 0 && !filtered ? (
        <EmptyState
          icon="library"
          title="No passages in search"
          description="This document has no passages yet, for example while it is still being ingested."
        />
      ) : (
        <div ref={body} className="kb-pbody">
          {outOfUse && (
            <Callout tone="warning">
              These passages aren’t used in answers or search while this document {outOfUse}.
            </Callout>
          )}
          <PassageFilters
            outline={listing.outline}
            filters={filters}
            reversed={reversed}
            searchable={!outOfUse}
            mode={mode}
            waiting={waiting}
            onChange={narrow}
            onMode={(next) => {
              setMode(next)
              // Choosing a way to search is asking for it: the typed words are searched now.
              if (words) search(words)
            }}
            onSearch={() => {
              if (mode === 'meaning' && words && words !== q) search(words)
            }}
          />
          {listing.total === 0 ? (
            <EmptyState
              icon="search-x"
              title="No passages match"
              description="Try other words, another chapter or a wider page range."
              action={
                <Button variant="secondary" size="sm" onClick={() => narrow(NO_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="kb-plist">
              <table className={stale ? 'kb-ptable is-stale' : 'kb-ptable'} aria-busy={stale}>
                <thead>
                  <tr>
                    <th className="kb-pcol-pos">#</th>
                    <th className="kb-pcol-section">Section</th>
                    <th className="kb-pcol-text">Passage</th>
                    <th className="kb-pcol-kind">Type</th>
                    <th className="kb-pcol-pages">Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {listing.passages.map((p) => (
                    <PassageRow
                      key={p.id}
                      passage={p}
                      fileUrl={d.fileUrl}
                      open={openId === p.id}
                      onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                    />
                  ))}
                </tbody>
              </table>
              <div className="kb-pfoot">
                <TableFooter>{shown(loaded.offset, listing, JSON.parse(loaded.key))}</TableFooter>
                <Pagination
                  page={Math.floor(offset / PAGE_SIZE) + 1}
                  pageCount={Math.ceil(listing.total / PAGE_SIZE)}
                  onPage={(page) => {
                    setOffset((page - 1) * PAGE_SIZE)
                    // The new page starts at the top, under the dialog's header.
                    body.current?.closest('dialog')?.scrollTo?.({ top: 0 })
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** The search field with its Words | Meaning switch (only for an active document: both
    searches skip the rest), the Chapter and Section dropdowns (one Section dropdown for a
    past report), the page range, and Clear filters once anything is narrowed. */
function PassageFilters({
  outline,
  filters,
  reversed,
  searchable,
  mode,
  waiting,
  onChange,
  onMode,
  onSearch,
}: {
  outline: PassageListing['outline']
  filters: Filters
  reversed: boolean
  searchable: boolean
  mode: SearchMode
  waiting: boolean
  onChange: (filters: Filters) => void
  onMode: (mode: SearchMode) => void
  onSearch: () => void
}) {
  const byClause = outline.by !== 'section'
  const { chapter, section } = filters
  return (
    <div className="kb-ptoolbar">
      <div className="kb-psearch">
        <SearchField
          label="Search this document"
          placeholder={
            mode === 'meaning'
              ? 'Describe what you’re looking for, then press Enter'
              : 'Search this document'
          }
          enterKeyHint="search"
          disabled={!searchable}
          title={searchable ? undefined : 'Search works once this document is active.'}
          value={filters.words}
          onChange={(e) => onChange({ ...filters, words: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
          end={
            <SegmentedControl
              ariaLabel="Search by"
              options={SEARCH_MODES.map((o) => ({ ...o, disabled: !searchable }))}
              value={mode}
              onChange={onMode}
            />
          }
        />
        {waiting && <p className="kb-psearch-hint">Press Enter to search</p>}
      </div>
      <Select
        aria-label={byClause ? 'Chapter' : 'Section'}
        options={[
          { value: '', label: byClause ? 'All chapters' : 'All sections' },
          ...outline.chapters.map((c) => ({
            value: `c:${c.name}`,
            label: `${named(chapterName(c.name, byClause), c.title)} (${c.count.toLocaleString('en')})`,
          })),
        ]}
        value={chapter === undefined ? '' : `c:${chapter}`}
        onChange={(e) =>
          onChange({
            ...filters,
            chapter: e.target.value ? e.target.value.slice(2) : undefined,
            section: undefined,
          })
        }
      />
      {byClause && (
        <Select
          aria-label="Section"
          title={chapter === undefined ? 'Choose a chapter first' : undefined}
          disabled={chapter === undefined}
          options={[{ value: '', label: 'All sections' }, ...sectionOptions(outline.sections)]}
          value={section === undefined ? '' : `s:${section}`}
          onChange={(e) =>
            onChange({ ...filters, section: e.target.value ? e.target.value.slice(2) : undefined })
          }
        />
      )}
      <div className="kb-prange">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="From page"
          placeholder="From page"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
        <span aria-hidden="true">–</span>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="To page"
          placeholder="To page"
          value={filters.to}
          error={reversed ? 'The range ends before it starts.' : undefined}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </div>
      {narrowed(filters) && (
        <Button variant="ghost" onClick={() => onChange(NO_FILTERS)}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

/** Five placeholder rows while the first page loads. */
function LoadingRows() {
  return (
    <div className="kb-pskeleton">
      <p className="ds-sr-only" role="status">
        Loading passages…
      </p>
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

/** One passage's row, and beneath it when open, the passage in full. */
function PassageRow({
  passage: p,
  fileUrl,
  open,
  onToggle,
}: {
  passage: DocumentPassage
  fileUrl: string
  open: boolean
  onToggle: () => void
}) {
  const panel = `kb-passage-${p.id}`
  const heading = p.headings.at(-1)
  return (
    <>
      <tr
        className={open ? 'kb-prow is-open' : 'kb-prow'}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) onToggle()
        }}
      >
        <td className="kb-pcol-pos">{p.position}</td>
        <td className="kb-pcol-section">
          <button
            type="button"
            className="kb-ptoggle"
            aria-expanded={open}
            aria-controls={panel}
            onClick={onToggle}
          >
            <Icon
              name={open ? IconRegistry.action.expand : IconRegistry.action.forward}
              size={14}
            />
            <span className={heading ? undefined : 'is-none'}>{heading ?? 'No heading'}</span>
          </button>
        </td>
        <td className="kb-pcol-text">
          <span className="kb-pexcerpt">{p.text}</span>
        </td>
        <td className="kb-pcol-kind">
          <span className="kb-pkind">
            {KINDS[p.kind]}
            {p.generated && <Badge tone="ai">Generated</Badge>}
          </span>
        </td>
        <td className="kb-pcol-pages">{pages(p)}</td>
      </tr>
      {open && (
        <tr className="kb-pdetail-row">
          <td colSpan={5}>
            <PassageDetail id={panel} passage={p} fileUrl={fileUrl} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The opened passage: its full text, the region of the page a table, formula or
    picture was read from (loaded only for those), and its id. */
function PassageDetail({
  id,
  passage: p,
  fileUrl,
}: {
  id: string
  passage: DocumentPassage
  fileUrl: string
}) {
  const loaded = usePassage(p.kind === 'text' ? undefined : p.id)
  return (
    <section id={id} className="kb-pdetail" aria-label={`Passage ${p.position}`}>
      {p.generated && (
        <p className="kb-pgenerated">
          A model described this picture; these aren’t the document’s words.
        </p>
      )}
      <PassageBody text={p.text} quote="" className="kb-passage-body" />
      {loaded.status === 'ready' && (
        <CitedRegion fileUrl={fileUrl} region={loaded.passage.region} />
      )}
      <p className="kb-pid">
        <span>Passage ID</span> {p.id}
      </p>
    </section>
  )
}

// "14", "12–13", or "—" when the passage has no page.
function pages(p: DocumentPassage): string {
  if (p.pageStart == null) return '—'
  if (p.pageEnd == null || p.pageEnd === p.pageStart) return String(p.pageStart)
  return `${p.pageStart}–${p.pageEnd}`
}

// "Passages 26–50 of 1,214": which of the matching passages this page shows. A search by
// meaning names its question, as the rows answer it rather than contain its words.
function shown(offset: number, listing: PassageListing, query: PassageQuery): string {
  const last = offset + listing.passages.length
  const of = listing.total.toLocaleString('en')
  const range = `Passages ${(offset + 1).toLocaleString('en')}–${last.toLocaleString('en')} of ${of}`
  return query.mode === 'meaning' ? `${range} matching “${query.q}”` : range
}

// A chapter as the filter names it: "Chapter 8", "Annex A", "Front matter". A past
// report's chapters are its template sections, named as they are.
function chapterName(name: string, byClause: boolean): string {
  if (!byClause) return name || 'No section'
  if (!name) return 'Front matter'
  return /^\d+$/.test(name) ? `Chapter ${name}` : `Annex ${name}`
}

// "Chapter 8 Installation": a chapter or section with its title, ending at a whole word
// within LABEL_CHARS so a dropdown doesn't grow to a paragraph.
const LABEL_CHARS = 60
function named(name: string, title: string | null): string {
  const full = title ? `${name} ${title}` : name
  if (full.length <= LABEL_CHARS) return full
  const cut = full.slice(0, LABEL_CHARS)
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`
}

// The chosen chapter's sections; "" is its start, before the first numbered section.
function sectionOptions(sections: OutlineEntry[]) {
  return sections.map((s) => ({
    value: `s:${s.name}`,
    label: `${named(s.name || 'Chapter start', s.title)} (${s.count.toLocaleString('en')})`,
  }))
}

// A typed page number, or undefined when blank or not a page (0, -2, 1.5).
function pageNumber(text: string): number | undefined {
  const page = Number(text)
  return text.trim() && Number.isInteger(page) && page >= 1 ? page : undefined
}
