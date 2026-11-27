// A document's passages as search holds them (IN-17): a table, one page at a time, in
// reading order, narrowed by chapter and section (from the document's outline) and pages.
// Each row shows the passage's place in the document, its nearest heading, an excerpt,
// what it was read from and its pages; opening it shows the passage in full. Read-only for
// everyone. Opened by screens/KnowledgeDocuments.tsx from a document's details. Calls
// PassageFilters, PassageRange (in the header) and PassageRow; their words are in passageText.ts.
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  Pagination,
  TableFooter,
} from '../../../design-system'
import {
  listDocumentPassages,
  type KnowledgeDocument,
  type PassageListing,
  type PassageQuery,
  type SearchMode,
} from '../api'
import { needsReview } from '../display'
import {
  narrowed,
  NO_FILTERS,
  PAGE_SIZE,
  pageNumber,
  SEARCH_PAUSE_MS,
  shown,
  type Filters,
} from '../passageText'
import { PassageFilters } from './PassageFilters'
import { PassageRange } from './PassageRange'
import { PassageRow } from './PassageRow'
import '../passages.css'

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
  // The filters show once a listing is in, unless the document has no passages at all.
  const filterable = !failed && !!listing && !(listing.total === 0 && !filtered)

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
      className="ds-dialog-sheet kb-passages"
      title="Passages"
      description={d.edition ? `${d.title} · ${d.edition}` : d.title}
      width={1040}
      onClose={onClose}
      headerAction={
        filterable && <PassageRange filters={filters} reversed={reversed} onChange={narrow} />
      }
      // The count and the pager sit in the dialog's pinned foot, so Next is always in reach
      // without scrolling past the page's passages. Before there is a list, the foot closes.
      footer={
        listing && listing.total > 0 ? (
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
        ) : (
          <Button pill variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {failed ? (
        <Callout
          tone="danger"
          title="Passages not loaded"
          actions={
            <Button
              pill
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
          Can't reach the server. Try again shortly.
        </Callout>
      ) : !listing ? (
        <LoadingRows />
      ) : listing.total === 0 && !filtered ? (
        <EmptyState
          icon="library"
          title="No passages in search"
          description="This document has no passages yet, for example while it is still being read."
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
                <Button pill variant="secondary" size="sm" onClick={() => narrow(NO_FILTERS)}>
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
                      documentId={d.id}
                      fileUrl={d.fileUrl}
                      open={openId === p.id}
                      onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
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
