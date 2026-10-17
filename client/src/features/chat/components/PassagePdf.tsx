// The PDF tab's body (CB-02 AC2): the cited page drawn by react-pdf (Mozilla's pdf.js), a
// light box over the whole passage, and the quoted words marked in the page's text layer.
// Loaded lazily by CitationPanel, so pdf.js stays out of the chat's first download.
import { useCallback, useMemo, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import 'react-pdf/dist/Page/TextLayer.css'
import type { Passage } from '../api'
import { markItems, quoteSpan } from './quoteSpan'

// react-pdf's docs: set the worker in the same module that renders <Document>. Vite turns the
// new URL(...) into a hashed file served next to the page. The legacy worker, to match the
// legacy pdf.js build vite.config.ts aliases in (older browsers).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Props = { fileUrl: string; passage: Passage; quote: string }

type PageSize = { width: number; height: number }

/** Returns the page to show: the first box's page, else the passage's first page, else 1. */
const citedPage = (p: Passage) => p.boxes[0]?.page ?? p.pageStart ?? 1

/** The cited PDF page with the passage box and quoted words highlighted. */
export function PassagePdf({ fileUrl, passage, quote }: Props) {
  const [width, setWidth] = useState(0)
  const [size, setSize] = useState<PageSize | null>(null)
  const [items, setItems] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const pageNumber = citedPage(passage)

  // Fit the page to the panel; without a width, react-pdf would draw it at full size.
  const frame = useCallback((el: HTMLDivElement | null) => {
    if (el) setWidth(el.clientWidth || 300)
  }, [])

  // Locate the quote in the page's own text (items joined by a space), and build the
  // per-item marker. Not found (scan, differing text) leaves the box alone.
  const textRenderer = useMemo(() => {
    const span = items && quoteSpan(quote, items.join(' '))
    if (!items || !span) return undefined
    const mark = markItems(items, span)
    return ({ itemIndex }: { itemIndex: number }) => mark(itemIndex)
  }, [items, quote])

  const boxes = passage.boxes.filter((b) => b.page === pageNumber)

  return (
    <div className="chat-pdf" ref={frame}>
      {failed ? (
        <p className="rv-viewer-note" role="alert">
          The page couldn't be shown here. Use "Open the original PDF" below.
        </p>
      ) : (
        <Document
          file={fileUrl}
          loading={<p className="rv-viewer-note">Loading the page…</p>}
          onLoadError={() => setFailed(true)}
          error=""
        >
          {width > 0 && (
            <div className="chat-pdf-page">
              <Page
                pageNumber={pageNumber}
                width={width}
                renderAnnotationLayer={false}
                customTextRenderer={textRenderer}
                onGetTextSuccess={(t: TextContent) =>
                  setItems(t.items.map((i) => ('str' in i ? i.str : '')))
                }
                onLoadSuccess={(p) => setSize({ width: p.originalWidth, height: p.originalHeight })}
                onLoadError={() => setFailed(true)}
                error=""
              />
              {size &&
                boxes.map((b, i) => (
                  <div
                    key={i}
                    className="chat-pdf-box"
                    data-testid="passage-box"
                    // Docling's origin is the page's bottom-left, the screen's is top-left,
                    // so the top edge is page height minus the box's top. Percentages keep
                    // it aligned at any rendered width.
                    style={{
                      left: `${(Math.min(b.l, b.r) / size.width) * 100}%`,
                      top: `${((size.height - Math.max(b.t, b.b)) / size.height) * 100}%`,
                      width: `${(Math.abs(b.r - b.l) / size.width) * 100}%`,
                      height: `${(Math.abs(b.t - b.b) / size.height) * 100}%`,
                    }}
                  />
                ))}
            </div>
          )}
        </Document>
      )}
    </div>
  )
}
