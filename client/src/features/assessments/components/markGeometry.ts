// The geometry and layout of a photo's marked area (CP-10); the box itself is
// MarkBox in PhotoMark.tsx. Fractions are of the upright photo, from its
// top-left corner. Used by ZoomablePhoto.tsx, PhotoGrid.tsx and PhotoReferences.tsx.
import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import type { PhotoRegion } from '../api'

// The layer over the image as shown, as percentages of the image element's
// box: `object-fit` letterboxes (contain) or crops (cover) the photo inside it.
// Until the photo has loaded, the whole box.
const WHOLE: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' }

// Where the photo sits inside its image element, as percentages of it.
function layerOf(img: HTMLImageElement | null, fit: 'contain' | 'cover'): CSSProperties | null {
  if (!img?.naturalWidth || !img.naturalHeight || !img.clientWidth || !img.clientHeight) return null
  const fits = fit === 'contain' ? Math.min : Math.max
  const scale = fits(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight)
  const width = (img.naturalWidth * scale) / img.clientWidth
  const height = (img.naturalHeight * scale) / img.clientHeight
  return {
    left: `${((1 - width) / 2) * 100}%`,
    top: `${((1 - height) / 2) * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  }
}

// The layer, measured when the photo loads (pass `measure` as its onLoad) and
// whenever the image element changes size.
export function useImageLayer(
  image: RefObject<HTMLImageElement | null>,
  fit: 'contain' | 'cover',
): { layer: CSSProperties; measure: () => void } {
  const [layer, setLayer] = useState<CSSProperties>(WHOLE)
  const measure = () => {
    const measured = layerOf(image.current, fit)
    if (measured) setLayer(measured)
  }
  useEffect(() => {
    const img = image.current
    if (!img || typeof ResizeObserver !== 'function') return
    // Also called once as it starts observing, so a photo loaded already is measured.
    const observer = new ResizeObserver(() => {
      const measured = layerOf(img, fit)
      if (measured) setLayer(measured)
    })
    observer.observe(img)
    return () => observer.disconnect()
  }, [image, fit])
  return { layer, measure }
}

// Fractions kept to four places, so a saved mark reads back as it was drawn.
const round = (n: number) => Math.round(n * 1e4) / 1e4
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
// The smallest side a mark can have: anything smaller is a click, not an area.
export const MIN_SIDE = 0.01

// The box between two points, each a fraction of the photo.
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): PhotoRegion {
  const [x1, x2] = [clamp01(Math.min(a.x, b.x)), clamp01(Math.max(a.x, b.x))]
  const [y1, y2] = [clamp01(Math.min(a.y, b.y)), clamp01(Math.max(a.y, b.y))]
  return { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) }
}

// The middle half of the photo: where a new mark starts, ready to move.
export const STARTING_MARK: PhotoRegion = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

// Moves the box by (dx, dy), or with `resize` grows it by them, kept inside the photo.
export function nudge(region: PhotoRegion, dx: number, dy: number, resize: boolean): PhotoRegion {
  if (resize) {
    const w = Math.min(1 - region.x, Math.max(MIN_SIDE * 2, region.w + dx))
    const h = Math.min(1 - region.y, Math.max(MIN_SIDE * 2, region.h + dy))
    return { ...region, w: round(w), h: round(h) }
  }
  const x = Math.min(1 - region.w, Math.max(0, region.x + dx))
  const y = Math.min(1 - region.h, Math.max(0, region.y + dy))
  return { ...region, x: round(x), y: round(y) }
}
