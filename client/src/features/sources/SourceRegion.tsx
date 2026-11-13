// The part of the original page a table, formula or picture passage was read from (KB-02 AC1-AC4),
// drawn by react-pdf like the chat's PDF tab and cut to the region's box, one frame per page.
// Loaded lazily by PassageDetails, so pdf.js stays out of the first download. Shows nothing when
// the file or a page can't be drawn: the passage text below still stands.
import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import type { PageBox } from '../chat/api'
import { openPdfSource } from '../chat/components/pdfSource'
// Also sets pdf.js's worker, before <Document> renders.
import { PDF_OPTIONS } from '../chat/components/pdfSetup'
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

type Size = { width: number; height: number }

type Props = { fileUrl: string; kind: RegionKind; boxes: PageBox[] }

/** One frame per page the region covers, in page order, each cut to its box. */
export function SourceRegion({ fileUrl, kind, boxes }: Props) {
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
    <Document
      file={source}
      options={PDF_OPTIONS}
      loading={null}
      error={null}
      onLoadError={() => setFailed(true)}
    >
      <div className="src-regions">
        {boxesByPage(boxes).map((box) => (
          <RegionFrame
            key={box.page}
            box={box}
            name={`${NAMES[kind]} on page ${box.page} of the original`}
          />
        ))}
      </div>
    </Document>
  )
}

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
function RegionFrame({ box: tight, name }: { box: PageBox; name: string }) {
  const [size, setSize] = useState<Size | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  if (failed) return null
  if (src) return <img className="src-region" src={src} alt={name} />
  const box = withMargin(tight, size)
  const width = box.r - box.l
  if (width <= 0 || box.t - box.b <= 0) return null
  const pageWidth = Math.min(MAX_PAGE, size ? (REGION_WIDTH * size.width) / width : REGION_WIDTH)
  const cut = (page: Size) => {
    const drawn = canvas.current
    const crop = drawn && cropOf(drawn, withMargin(tight, page), page)
    if (crop) setSrc(crop)
    else setFailed(true)
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
        onRenderSuccess={(p) => cut({ width: p.originalWidth, height: p.originalHeight })}
        onRenderError={() => setFailed(true)}
        error=""
      />
    </div>
  )
}

/** The box's pixels from the drawn page, as a PNG data URL; null when the browser can't copy. */
function cropOf(drawn: HTMLCanvasElement, box: PageBox, page: Size): string | null {
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
  return out.toDataURL('image/png')
}
