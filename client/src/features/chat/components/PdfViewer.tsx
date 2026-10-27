// The PDF tab (CB-02 AC2): the source document drawn by react-pdf (Mozilla's pdf.js), opened at
// the page holding the quote fitted whole into the panel, the passage outlined on each of its
// pages and the quoted words in yellow (quoteRects.ts). A bar to step pages, zoom, expand over the chat and open the original.
// Loaded lazily by CitationPanel, so pdf.js stays out of the chat's first download.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import { Icon, IconButton } from '../../../design-system'
import type { Passage } from '../api'
import { openPdfSource } from './pdfSource'
import { quoteRects, type PdfText, type Rect } from './quoteRects'

// react-pdf's docs: set the worker in the same module that renders <Document>. Vite turns the
// new URL(...) into a hashed file served next to the page. The legacy worker, to match the
// legacy pdf.js build vite.config.ts aliases in (older browsers).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Props = {
  fileUrl: string
  /** Null while the passage loads: the file starts loading meanwhile, the page waits. */
  passage: Passage | null
  quote: string
  /** False while the Passage tab hides this one (it stays mounted, CitationPanel.tsx). */
  shown: boolean
  expanded: boolean
  onToggleExpand: () => void
}

type Size = { width: number; height: number }

// Page size as a multiple of "fit": the whole page inside the viewer. Levels past a 1600px
// page are left out: a bigger canvas can pass iOS Safari's pixel limit on a 2x screen and
// draw blank.
const ZOOMS = [1, 1.25, 1.5, 2, 3]
const MAX_PAGE = 1600
// The page's margin inside the scroll area, on each side (must match .chat-pdf-scroll padding).
const GUTTER = 16
// The tab bar and the toolbar above the page, about 90px, taken off the panel's height while
// the PDF tab is hidden and can't be measured.
const HIDDEN_CHROME = 90
// US Letter, until the page's own size is known: the placeholder's shape.
const LETTER = 11 / 8.5
// pdf.js asks for byte ranges only as pages need them (pdfSource.ts fetches them), instead of
// fetching pages nobody looks at. A module constant, so react-pdf doesn't reload the document
// on every render.
const PDF_OPTIONS = { disableAutoFetch: true }

/** Returns the passage's pages: those its boxes sit on plus its page range, else page 1. */
// Both, because a picture passage's boxes cover only the figure's page while its text, and so the
// quote, can run on to the next page.
function passagePages(p: Passage): number[] {
  const range =
    p.pageStart == null
      ? []
      : Array.from(
          { length: (p.pageEnd ?? p.pageStart) - p.pageStart + 1 },
          (_, i) => p.pageStart! + i,
        )
  const all = [...new Set([...p.boxes.map((b) => b.page), ...range])].sort((a, b) => a - b)
  return all.length ? all : [1]
}

/** Returns a page rectangle's position as percentages of the drawn page. */
// PDF points have their origin at the page's bottom-left, the screen's is top-left, so the
// top edge is page height minus the rectangle's top. Percentages keep it aligned at any zoom.
function place(r: Rect, size: Size) {
  return {
    left: `${(Math.min(r.l, r.r) / size.width) * 100}%`,
    top: `${((size.height - Math.max(r.t, r.b)) / size.height) * 100}%`,
    width: `${(Math.abs(r.r - r.l) / size.width) * 100}%`,
    height: `${(Math.abs(r.t - r.b) / size.height) * 100}%`,
  }
}

/** Returns a pdf.js text item's page, text, baseline start, width and font height. */
const toPdfText = (i: TextItem, page: number): PdfText => ({
  page,
  str: i.str,
  x: i.transform[4],
  y: i.transform[5],
  width: i.width,
  height: i.height,
})

/** The source PDF at the cited page, with the passage and quoted words highlighted. */
export function PdfViewer({ fileUrl, passage, quote, shown, expanded, onToggleExpand }: Props) {
  const pages = useMemo(() => (passage ? passagePages(passage) : null), [passage])
  // The page the engineer stepped to; until then the cited page shows (worked out below).
  const [chosen, setPage] = useState<number | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [frame, setFrame] = useState<Size | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [items, setItems] = useState<PdfText[] | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  // The file as byte ranges (pdfSource.ts): its length and first bytes, then ranges on demand.
  // Wrapped as { range }, react-pdf's form for it; kept in state so it is the same object
  // every render (a new one would reload the document).
  const [source, setSource] = useState<{
    range: Awaited<ReturnType<typeof openPdfSource>>
  } | null>(null)
  useEffect(() => {
    let current = true
    openPdfSource(fileUrl).then(
      (range) => current && setSource({ range }),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [fileUrl])
  const [picked, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)

  // a. The viewer's inner size, followed as the panel is resized or expanded. Settled for
  //    120ms before it is used: redrawing the page on every pixel of a drag would stutter.
  useEffect(() => {
    const area = scroller.current
    if (!area) return
    let timer: ReturnType<typeof setTimeout>
    let first = true
    // True while the size is the hidden-tab stand-in: the real one then applies at once, as
    // the panel widens for the PDF tab, instead of after the drag delay.
    let estimated = false
    const measure = () => {
      // Hidden behind the Passage tab it measures 0. The first time, the panel around it
      // stands in (less the tab bar and toolbar), so the page is drawn while the engineer
      // reads and is there on clicking PDF; later, the last size is kept. jsdom (tests) has no
      // layout at all: 300 x 400 stands in.
      const panel = area.closest('.chat-source')
      const width = area.clientWidth || (first ? (panel?.clientWidth ?? 0) : 0)
      if (!width && typeof ResizeObserver !== 'undefined') return
      const height = area.clientHeight || (panel ? panel.clientHeight - HIDDEN_CHROME : 0)
      const immediate = first || (estimated && area.clientWidth > 0)
      estimated = !area.clientWidth
      clearTimeout(timer)
      timer = setTimeout(
        () =>
          setFrame({
            width: (width || 300 + 2 * GUTTER) - 2 * GUTTER,
            height: (height > 0 ? height : 400 + 2 * GUTTER) - 2 * GUTTER,
          }),
        immediate ? 0 : 120,
      )
      first = false
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return () => clearTimeout(timer)
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [])

  // b. "Fit": the widest page that still shows whole, by the frame's width and height.
  //    Until the page's own size is known, a Letter page's shape stands in.
  const aspect = size ? size.width / size.height : 1 / LETTER
  const fit = frame ? Math.min(frame.width, frame.height * aspect) : 0
  const levels = ZOOMS.filter((z) => z === 1 || fit * z <= MAX_PAGE)
  // A bigger frame (Expand) can drop the chosen level past the cap; the largest allowed
  // level below it stands in, so the buttons always step from a level in the list.
  const zoom = levels.findLast((z) => z <= picked) ?? 1

  // c. The quoted words, found in the text of all the passage's pages read in order, since a
  //    passage (and a quote) can run over a page break. The text layer itself isn't drawn: in
  //    some PDFs it sits off the printed words and selecting text looked broken.
  const onDocumentLoad = (loaded: PDFDocumentProxy) => {
    setPageCount(loaded.numPages)
    setPdf(loaded)
  }
  // Read once both the document and the passage (its pages) are in, whichever comes last.
  useEffect(() => {
    if (!pdf || !pages) return
    let current = true
    Promise.all(
      pages.map((n) =>
        pdf
          .getPage(n)
          .then((p) => {
            // The first page's real size, so the placeholder already has the page's shape.
            if (n === pages[0]) {
              const { width, height } = p.getViewport({ scale: 1 })
              setSize((known) => known ?? { width, height })
            }
            return p.getTextContent()
          })
          .then((t) =>
            t.items.filter((i): i is TextItem => 'str' in i).map((i) => toPdfText(i, n)),
          ),
      ),
    ).then(
      (perPage) => current && setItems(perPage.flat()),
      () => current && setItems([]),
    )
    return () => {
      current = false
    }
  }, [pdf, pages])
  // react-pdf adds the page's unscaled size to pdf.js's page.
  const onPageLoad = (p: PDFPageProxy & { originalWidth: number; originalHeight: number }) =>
    setSize({ width: p.originalWidth, height: p.originalHeight })
  const marks = useMemo(() => (items ? quoteRects(items, quote) : []), [items, quote])
  // The cited page: where the quote's first words are, else where the passage is outlined.
  // With no highlight: the first outlined page (the passage's boxes), else its first page.
  const firstOutlined = passage?.boxes.length ? Math.min(...passage.boxes.map((b) => b.page)) : null
  const cited = marks[0]?.page ?? firstOutlined ?? pages?.[0] ?? 1
  // Opens on the cited page (Jesper, 18 Oct) until the engineer steps elsewhere. Worked out
  // here rather than set by an effect, so no render ever shows another page first.
  const page = chosen ?? cited
  const notFound = items !== null && marks.length === 0 && Boolean(pages?.includes(page))
  // A scan has no text layer, so there is nothing to search: said so, not "couldn't be found".
  const scanned = items !== null && !items.some((t) => t.page === page && t.str.trim())
  // The page is drawn only once the cited page is known, so the first page drawn is the right
  // one; drawing the passage's first page and then jumping flashed a blank canvas.
  const ready = items !== null

  // d. The quote is brought to the middle of the viewer once it is drawn, and again after a
  //    zoom; not after a resize, which would undo the engineer's own scrolling. Hidden (the
  //    engineer went back to Passage first), it can't be scrolled, so it waits.
  const toCentre = useRef(true)
  useEffect(() => {
    toCentre.current = true
  }, [zoom])
  const showQuote = useCallback(() => {
    const area = scroller.current
    const mark = area?.querySelector('.chat-pdf-mark')
    if (!toCentre.current || !area || !mark || !area.clientHeight) return
    toCentre.current = false
    const a = area.getBoundingClientRect()
    const m = mark.getBoundingClientRect()
    area.scrollTop += m.top - a.top - (a.height - m.height) / 2
    area.scrollLeft += m.left - a.left - (a.width - m.width) / 2
  }, [])
  useEffect(showQuote, [marks, showQuote])
  useEffect(() => {
    if (shown) showQuote()
  }, [shown, showQuote])

  // A blank page in the page's own place and shape, shown while pdf.js loads or draws: the
  // toolbar and layout stay put instead of the viewer flashing to a loading line.
  const pageWidth = fit * zoom
  const sheet = (
    <div
      className="chat-pdf-sheet"
      role="status"
      aria-label="Loading the PDF"
      style={{
        width: pageWidth || '100%',
        aspectRatio: size ? `${size.width} / ${size.height}` : `1 / ${LETTER}`,
      }}
    />
  )

  const boxes = passage?.boxes.filter((b) => b.page === page) ?? []
  const marksHere = marks.filter((m) => m.page === page)

  return (
    <div className="chat-pdf">
      <div className="chat-pdf-bar">
        <div className="chat-pdf-group">
          <IconButton
            icon="chevron-left"
            label="Previous page"
            size="sm"
            disabled={!ready || page <= 1}
            onClick={() => setPage(page - 1)}
          />
          <span className="chat-pdf-count">
            Page {ready ? page : '–'}
            {pageCount ? ` of ${pageCount}` : ''}
          </span>
          <IconButton
            icon="chevron-right"
            label="Next page"
            size="sm"
            disabled={!ready || pageCount === null || page >= pageCount}
            onClick={() => setPage(page + 1)}
          />
        </div>
        <div className="chat-pdf-group">
          <IconButton
            icon="zoom-out"
            label="Zoom out"
            size="sm"
            disabled={zoom === levels[0]}
            onClick={() => setZoom(levels[levels.indexOf(zoom) - 1])}
          />
          <span className="chat-pdf-count">{zoom === 1 ? 'Fit' : `${zoom * 100}%`}</span>
          <IconButton
            icon="zoom-in"
            label="Zoom in"
            size="sm"
            disabled={zoom === levels.at(-1)}
            onClick={() => setZoom(levels[levels.indexOf(zoom) + 1])}
          />
        </div>
        <span className="chat-pdf-spacer" />
        <div className="chat-pdf-group chat-pdf-actions">
          <IconButton
            className="chat-pdf-expand"
            icon={expanded ? 'minimize-2' : 'maximize-2'}
            label={expanded ? 'Exit full view' : 'Expand'}
            title={expanded ? 'Exit full view' : 'Expand over the chat'}
            size="sm"
            onClick={onToggleExpand}
          />
          <a
            className="chat-pdf-open"
            href={`${fileUrl}#page=${page}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the original PDF"
            title="Open the original PDF"
          >
            <Icon name="external-link" size={14} />
          </a>
        </div>
      </div>
      {notFound && (
        <p className="chat-pdf-note" role="status">
          {scanned ? (
            <>
              This page is a scan, so the quoted words can't be highlighted. The outline marks the
              passage.
            </>
          ) : (
            <>The quoted words couldn't be found on this page. The outline marks the passage.</>
          )}
        </p>
      )}
      {page !== cited && (
        <button
          type="button"
          className="chat-pdf-note chat-pdf-return"
          onClick={() => setPage(cited)}
        >
          Back to the cited page ({cited})
        </button>
      )}
      <div
        className="chat-pdf-scroll"
        ref={scroller}
        role="region"
        tabIndex={0}
        aria-label="PDF page"
      >
        {failed ? (
          <p className="rv-viewer-note" role="alert">
            The PDF couldn't be shown here. Use the open button above to view the original.
          </p>
        ) : !source ? (
          sheet
        ) : (
          <Document
            file={source}
            // Not suspended: react-pdf would otherwise hand loading to the nearest Suspense,
            // CitationPanel's around the whole viewer, which blanked the toolbar too.
            suspense={false}
            loading={sheet}
            options={PDF_OPTIONS}
            onLoadSuccess={onDocumentLoad}
            onLoadError={() => setFailed(true)}
            error=""
          >
            {!frame || !ready ? (
              sheet
            ) : (
              <div className="chat-pdf-page">
                <Page
                  pageNumber={page}
                  width={pageWidth}
                  suspense={false}
                  loading={sheet}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={onPageLoad}
                  onRenderSuccess={showQuote}
                  onLoadError={() => setFailed(true)}
                  error=""
                />
                {size &&
                  boxes.map((b, i) => (
                    <div
                      key={i}
                      className="chat-pdf-box"
                      data-testid="passage-box"
                      style={place(b, size)}
                    />
                  ))}
                {size &&
                  marksHere.map((m, i) => (
                    <div
                      key={i}
                      className="chat-pdf-mark"
                      data-testid="quote-mark"
                      style={place(m, size)}
                    />
                  ))}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  )
}
