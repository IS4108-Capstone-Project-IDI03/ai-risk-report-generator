// The part of the original page a table, formula or picture passage was read from (KB-02 AC1-AC4),
// drawn by react-pdf like the chat's PDF tab and cut to the region's box, one frame per page.
// Loaded lazily by PassageDetails, so pdf.js stays out of the first download. Shows nothing when
// the file or a page can't be drawn: the passage text below still stands. `onDrawn` says when every
// page's frame is cut, so a view can fold a table's or formula's text behind it. A table's crop
// shows the quoted words in yellow, as the PDF tab does, when they are in the table's printed text.
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Document, Page } from 'react-pdf'
import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import type { PageBox } from '../chat/api'
import { openPdfSource } from '../chat/components/pdfSource'
// Also sets pdf.js's worker, before <Document> renders.
import { PDF_OPTIONS } from '../chat/components/pdfSetup'
import { quoteRects, toPdfText, type Rect } from '../chat/components/quoteRects'
import './sources.css'

export type RegionKind = 'table' | 'formula' | 'picture'

const NAMES: Record<RegionKind, string> = { table: 'Table', formula: 'Formula', picture: 'Picture' }
// A region is drawn this wide in pixels, then scaled by CSS to the panel: sharp at panel widths
// on a 2x screen. The whole page is drawn larger in proportion, capped like the PDF tab's.
const REGION_WIDTH = 720
const MAX_PAGE = 1600
// Docling's boxes sit tight on a table's top rule or a formula's ink, so the frame shows this many
// points more on each side, kept inside the page.
const MARGIN = 8
// The quoted words' wash: the chat's highlighter (--chat-highlight), multiplied into the page so
// the black text stays crisp under it, as on the PDF tab.
const HIGHLIGHT = '#fde68a'

type Size = { width: number; height: number }

type Props = {
  fileUrl: string
  kind: RegionKind
  boxes: PageBox[]
  /** The cited words, marked on a table's crop when its printed text holds them; '' for none. */
  quote?: string
  /** Called once every page's frame is cut; never when one fails. */
  onDrawn?: () => void
}

/** One frame per page the region covers, in page order, each cut to its box. */
export function SourceRegion({ fileUrl, kind, boxes, quote = '', onDrawn }: Props) {
  // Only a table's printed words can match: a picture's description was written by AI, and a
  // formula's text is the OCR's LaTeX.
  const marked = kind === 'table' ? quote : ''
  const frames = boxesByPage(boxes)
  // The frames cut so far, by key; a ref, as only the call to onDrawn depends on it. A frame is
  // keyed by its box, so another region on the same page is cut afresh.
  const cutFrames = useRef(new Set<string>())
  const frameCut = (key: string) => {
    cutFrames.current.add(key)
    if (frames.every((box) => cutFrames.current.has(frameKey(box)))) onDrawn?.()
  }
  // Wrapped as { range }, react-pdf's form for a byte-range source; kept in state so it is the
  // same object every render (a new one would reload the document).
  const [source, setSource] = useState<{
    range: Awaited<ReturnType<typeof openPdfSource>>
  } | null>(null)
  const [failed, setFailed] = useState(false)
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
  if (failed || !source) return null
  return (
    // suspense={false}, as the PDF tab's: react-pdf 11 suspends by default, and its cache lets a
    // suspended document go once shown, so every render opened the PDF again in a new worker
    // and the region was never cut.
    <Document
      file={source}
      options={PDF_OPTIONS}
      suspense={false}
      loading={null}
      error={null}
      onLoadError={() => setFailed(true)}
    >
      <div className="src-regions">
        {frames.map((box) => (
          <RegionFrame
            // Cut afresh for another quote, so its words are the ones marked.
            key={`${frameKey(box)}|${marked}`}
            box={box}
            quote={marked}
            name={`${NAMES[kind]} on page ${box.page} of the original`}
            onCut={() => frameCut(frameKey(box))}
          />
        ))}
      </div>
    </Document>
  )
}

const frameKey = (b: PageBox) => `${b.page}:${b.l},${b.t},${b.r},${b.b}`

/** The region's boxes as one box per page (their union), in page order. */
function boxesByPage(boxes: PageBox[]): PageBox[] {
  const byPage = new Map<number, PageBox>()
  for (const b of boxes) {
    const box = {
      page: b.page,
      l: Math.min(b.l, b.r),
      r: Math.max(b.l, b.r),
      t: Math.max(b.t, b.b),
      b: Math.min(b.t, b.b),
    }
    const seen = byPage.get(b.page)
    byPage.set(
      b.page,
      seen
        ? {
            page: b.page,
            l: Math.min(seen.l, box.l),
            r: Math.max(seen.r, box.r),
            t: Math.max(seen.t, box.t),
            b: Math.min(seen.b, box.b),
          }
        : box,
    )
  }
  return [...byPage.values()].sort((x, y) => x.page - y.page)
}

/** The box with MARGIN points more on each side, inside the page once its size is known. */
function withMargin(box: PageBox, page: Size | null): PageBox {
  return {
    page: box.page,
    l: Math.max(0, box.l - MARGIN),
    b: Math.max(0, box.b - MARGIN),
    r: page ? Math.min(page.width, box.r + MARGIN) : box.r + MARGIN,
    t: page ? Math.min(page.height, box.t + MARGIN) : box.t + MARGIN,
  }
}

/** The box cut out of the drawn page as an image, which the panel scales down to fit like any
 * picture. The page is drawn out of sight, then let go once its box is copied. */
function RegionFrame({
  box: tight,
  name,
  quote,
  onCut,
}: {
  box: PageBox
  name: string
  quote: string
  onCut: () => void
}) {
  const [size, setSize] = useState<Size | null>(null)
  // The cut image and its shape (width over height), which a view may size it by.
  const [cut, setCut] = useState<{ src: string; ratio: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const isCut = cut !== null
  useEffect(() => {
    if (isCut) onCut()
    // Once per cut; onCut is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCut])
  if (failed) return null
  if (cut)
    return (
      <img
        className="src-region"
        src={cut.src}
        alt={name}
        style={{ '--region-ratio': cut.ratio } as React.CSSProperties}
      />
    )
  const box = withMargin(tight, size)
  const width = box.r - box.l
  if (width <= 0 || box.t - box.b <= 0) return null
  const pageWidth = Math.min(MAX_PAGE, size ? (REGION_WIDTH * size.width) / width : REGION_WIDTH)
  const cutOut = (proxy: PDFPageProxy, page: Size) => {
    const drawn = canvas.current
    const shown = withMargin(tight, page)
    // Copied at once: the drawn page is let go as soon as the frame is cut.
    const crop = drawn && cropOf(drawn, shown, page)
    if (!crop) return setFailed(true)
    const done = () =>
      setCut({ src: crop.toDataURL('image/png'), ratio: (shown.r - shown.l) / (shown.t - shown.b) })
    if (!quote) return done()
    // The page's words inside the table's box, so the same words elsewhere on the page don't count.
    // Unmarked when they can't be read or don't hold the quote: the crop still shows.
    Promise.resolve()
      .then(() => proxy.getTextContent())
      .then((content) => {
        const words = content.items
          .filter((i): i is TextItem => 'str' in i)
          .map((i) => toPdfText(i, tight.page))
          .filter((t) => inside(t.x, t.y, tight))
        markQuote(crop, quoteRects(words, quote), shown)
      })
      .catch(() => undefined)
      .finally(done)
  }
  return (
    <div className="src-region-draw" aria-hidden="true">
      <Page
        pageNumber={box.page}
        width={pageWidth}
        canvasRef={canvas}
        suspense={false}
        loading={null}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={(p) => setSize({ width: p.originalWidth, height: p.originalHeight })}
        onLoadError={() => setFailed(true)}
        onRenderSuccess={(p) => cutOut(p, { width: p.originalWidth, height: p.originalHeight })}
        onRenderError={() => setFailed(true)}
        error=""
      />
    </div>
  )
}

/** Whether a word's baseline start lies in the box, give or take MARGIN points. */
function inside(x: number, y: number, box: PageBox) {
  return x >= box.l - MARGIN && x <= box.r + MARGIN && y >= box.b - MARGIN && y <= box.t + MARGIN
}

/** Washes the quote's rectangles (PDF points) yellow on the crop of `box`. */
function markQuote(crop: HTMLCanvasElement, rects: Rect[], box: PageBox) {
  const context = crop.getContext('2d')
  if (!context || rects.length === 0) return
  // Pixels per point, as the crop was copied: its width over the box's.
  const scale = crop.width / (box.r - box.l)
  context.globalCompositeOperation = 'multiply'
  context.fillStyle = HIGHLIGHT
  for (const r of rects) {
    // PDF points run up from the page's bottom-left; the crop's pixels down from the box's top-left.
    context.fillRect(
      (r.l - box.l) * scale,
      (box.t - r.t) * scale,
      (r.r - r.l) * scale,
      (r.t - r.b) * scale,
    )
  }
  context.globalCompositeOperation = 'source-over'
}

/** The box's pixels from the drawn page, on a canvas of their own; null when the browser can't copy. */
function cropOf(drawn: HTMLCanvasElement, box: PageBox, page: Size): HTMLCanvasElement | null {
  // Pixels per point: react-pdf draws the page at its width times the screen's pixel ratio.
  const scale = drawn.width / page.width
  // PDF points run up from the page's bottom-left; canvas pixels run down from its top-left.
  const sx = box.l * scale
  const sy = (page.height - box.t) * scale
  const sw = (box.r - box.l) * scale
  const sh = (box.t - box.b) * scale
  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  const context = out.getContext('2d')
  if (!context) return null
  context.drawImage(drawn, sx, sy, sw, sh, 0, 0, sw, sh)
  return out
}
