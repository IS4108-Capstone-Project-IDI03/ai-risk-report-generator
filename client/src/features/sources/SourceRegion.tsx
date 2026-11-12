// The part of the original page a table, formula or picture passage was read from (KB-02 AC1-AC4),
// drawn by react-pdf like the chat's PDF tab and cut to the region's box, one frame per page.
// Loaded lazily by PassageDetails, so pdf.js stays out of the first download. Shows nothing when
// the file or a page can't be drawn: the passage text below still stands.
import { useEffect, useState } from 'react'
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

/** One page drawn inside a frame the shape of its box, shifted so only the box shows. */
function RegionFrame({ box, name }: { box: PageBox; name: string }) {
  const [size, setSize] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const width = box.r - box.l
  const height = box.t - box.b
  if (width <= 0 || height <= 0) return null
  // PDF points run up from the page's bottom-left; the screen runs down from its top-left.
  const placed = size && {
    width: `${(size.width / width) * 100}%`,
    left: `${(-box.l / width) * 100}%`,
    top: `${(-(size.height - box.t) / height) * 100}%`,
  }
  const pageWidth = Math.min(MAX_PAGE, size ? (REGION_WIDTH * size.width) / width : REGION_WIDTH)
  return (
    <div
      role="img"
      aria-label={name}
      className="src-region"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div className="src-region-page" style={placed ?? { visibility: 'hidden' }}>
        <Page
          pageNumber={box.page}
          width={pageWidth}
          suspense={false}
          loading={null}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          onLoadSuccess={(p) => setSize({ width: p.originalWidth, height: p.originalHeight })}
          onLoadError={() => setFailed(true)}
          error=""
        />
      </div>
    </div>
  )
}
