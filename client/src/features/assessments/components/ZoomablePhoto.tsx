import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Icon } from '../../../design-system'
import type { PhotoRegion } from '../api'
import { MarkBox } from './PhotoMark'
import { boxBetween, MIN_SIDE, nudge, useImageLayer } from './markGeometry'
import '../capture.css'

const MIN = 1
const MAX = 8
const STEP = 1.5

// How far in the photo is zoomed, and how far it is moved from the centre.
type View = { scale: number; x: number; y: number }
const FIT: View = { scale: 1, x: 0, y: 0 }

// Keeps the zoomed photo covering the frame, so it cannot be dragged away.
function clamp(view: View, frame: DOMRect): View {
  const maxX = ((view.scale - 1) * frame.width) / 2
  const maxY = ((view.scale - 1) * frame.height) / 2
  return {
    scale: view.scale,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  }
}

// Zooms to `scale`, keeping the point (px, py) from the frame's centre where it is.
function zoomAt(view: View, scale: number, px: number, py: number, frame: DOMRect): View {
  const s = Math.min(MAX, Math.max(MIN, scale))
  if (s === MIN) return FIT
  const k = s / view.scale
  return clamp({ scale: s, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, frame)
}

// How far arrow keys move or resize a mark, as a fraction of the photo.
const MARK_STEP = 0.05

// A photo to look over closely: scroll or pinch to zoom, drag to move,
// double-click to zoom in or back out, or use the buttons and keys. With
// `region`, the area the engineer marked shows on it (CP-10). With `onMark`,
// the engineer is marking: one finger or the mouse draws the box instead of
// moving the photo, zoom still works, and arrow keys move the box (with Shift,
// resize it).
export function ZoomablePhoto({
  src,
  alt,
  region,
  onMark,
  actions,
}: {
  src: string
  alt: string
  region?: PhotoRegion | null
  onMark?: (region: PhotoRegion) => void
  // More controls for the toolbar, after the zoom buttons (the mark's, CP-10),
  // so they take no extra row above the photo.
  actions?: React.ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const { layer, measure } = useImageLayer(image, 'contain')
  const [view, setView] = useState<View>(FIT)
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  // Where a mark being drawn started, and the mark before it, to go back to
  // when the drag was only a click or became a pinch.
  const drawing = useRef<{ from: { x: number; y: number }; before: PhotoRegion | null } | null>(
    null,
  )
  const marking = !!onMark
  // A point on screen as a fraction of the photo; the layer is the photo as
  // shown, zoom included.
  const onPhoto = (clientX: number, clientY: number) => {
    const r = layerRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  const rect = () => frame.current!.getBoundingClientRect()
  // A client position as an offset from the frame's centre.
  const fromCentre = (clientX: number, clientY: number) => {
    const r = rect()
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const
  }
  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.scale * factor, 0, 0, rect()))
  const pan = (dx: number, dy: number) =>
    setView((v) => (v.scale > 1 ? clamp({ ...v, x: v.x + dx, y: v.y + dy }, rect()) : v))

  // React's wheel listener is passive, so the page would scroll as well.
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const r = element.getBoundingClientRect()
      const px = event.clientX - r.left - r.width / 2
      const py = event.clientY - r.top - r.height / 2
      const factor = Math.exp(-event.deltaY * 0.002)
      setView((v) => zoomAt(v, v.scale * factor, px, py, r))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setDragging(true)
    if (!onMark) return
    if (pointers.current.size === 1) {
      drawing.current = { from: onPhoto(event.clientX, event.clientY), before: region ?? null }
    } else if (drawing.current) {
      // A second finger: a pinch, not a mark.
      if (drawing.current.before) onMark(drawing.current.before)
      drawing.current = null
    }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const all = pointers.current
    const last = all.get(event.pointerId)
    if (!last) return
    const now = { x: event.clientX, y: event.clientY }
    if (all.size === 1 && drawing.current) {
      onMark!(boxBetween(drawing.current.from, onPhoto(now.x, now.y)))
    } else if (all.size === 1) {
      pan(now.x - last.x, now.y - last.y)
    } else if (all.size === 2) {
      // Pinch: zoom by how much the two fingers spread, about their midpoint.
      const other = [...all.entries()].find(([id]) => id !== event.pointerId)![1]
      const before = Math.hypot(last.x - other.x, last.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      const [px, py] = fromCentre((now.x + other.x) / 2, (now.y + other.y) / 2)
      if (before > 0) setView((v) => zoomAt(v, (v.scale * after) / before, px, py, rect()))
    }
    all.set(event.pointerId, now)
  }
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (!pointers.current.size) setDragging(false)
    const drawn = drawing.current
    if (!drawn) return
    drawing.current = null
    const box = boxBetween(drawn.from, onPhoto(event.clientX, event.clientY))
    // Only a click: keep the mark there was.
    if (box.w < MIN_SIDE || box.h < MIN_SIDE) {
      if (drawn.before) onMark!(drawn.before)
    } else onMark!(box)
  }
  const onDoubleClick = (event: React.MouseEvent) => {
    const [px, py] = fromCentre(event.clientX, event.clientY)
    setView((v) => (v.scale > 1 ? FIT : zoomAt(v, 2.5, px, py, rect())))
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-MARK_STEP, 0],
      ArrowRight: [MARK_STEP, 0],
      ArrowUp: [0, -MARK_STEP],
      ArrowDown: [0, MARK_STEP],
    }
    if (onMark && region && arrows[event.key]) {
      event.preventDefault()
      const [dx, dy] = arrows[event.key]
      onMark(nudge(region, dx, dy, event.shiftKey))
      return
    }
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(STEP),
      '=': () => zoomBy(STEP),
      '-': () => zoomBy(1 / STEP),
      '0': () => setView(FIT),
      ArrowLeft: () => pan(40, 0),
      ArrowRight: () => pan(-40, 0),
      ArrowUp: () => pan(0, 40),
      ArrowDown: () => pan(0, -40),
    }
    const act = keys[event.key]
    if (!act) return
    event.preventDefault()
    act()
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <button
          type="button"
          className="cap-btn cap-btn--secondary"
          style={{ width: '44px', padding: 0 }}
          aria-label="Zoom out"
          disabled={view.scale <= MIN}
          onClick={() => zoomBy(1 / STEP)}
        >
          <Icon name="zoom-out" size={18} />
        </button>
        <span
          aria-live="polite"
          style={{
            minWidth: '48px',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '13px',
            color: 'var(--text-secondary)',
          }}
        >
          {Math.round(view.scale * 100) + '%'}
        </span>
        <button
          type="button"
          className="cap-btn cap-btn--secondary"
          style={{ width: '44px', padding: 0 }}
          aria-label="Zoom in"
          disabled={view.scale >= MAX}
          onClick={() => zoomBy(STEP)}
        >
          <Icon name="zoom-in" size={18} />
        </button>
        <button
          type="button"
          className="cap-btn cap-btn--secondary"
          style={{ width: '44px', padding: 0 }}
          aria-label="Fit to window"
          disabled={view.scale === MIN}
          onClick={() => setView(FIT)}
        >
          <Icon name="scan" size={18} />
        </button>
        {actions}
        {/* Says how to zoom, plainly, until the photo is zoomed. */}
        <span style={{ marginLeft: 'auto', fontSize: '14px', color: 'var(--text-secondary)' }}>
          {marking
            ? 'Drag over the part that matters'
            : view.scale > 1
              ? 'Drag to move'
              : 'Pinch, scroll or double-click to zoom in'}
        </span>
      </div>
      <div
        ref={frame}
        tabIndex={0}
        aria-label={
          marking
            ? alt +
              '. Drag over the part that matters. Arrow keys move the mark, Shift and arrow keys resize it. Plus and minus zoom.'
            : alt + '. Use plus and minus to zoom, arrow keys to move, 0 to fit.'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          height: 'min(78svh, 960px)',
          overflow: 'hidden',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
          cursor: marking
            ? 'crosshair'
            : view.scale > 1
              ? dragging
                ? 'grabbing'
                : 'grab'
              : 'zoom-in',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* The photo and its mark zoom and move together. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
        >
          <img
            ref={image}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={measure}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
          />
          <div
            ref={layerRef}
            data-testid="photo-layer"
            style={{ position: 'absolute', ...layer, pointerEvents: 'none' }}
          >
            {region && <MarkBox region={region} marking={marking} />}
          </div>
        </div>
      </div>
    </div>
  )
}
