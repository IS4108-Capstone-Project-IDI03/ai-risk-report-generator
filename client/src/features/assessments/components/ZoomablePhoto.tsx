import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { IconButton } from '../../../design-system'

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

// A photo to look over closely: scroll or pinch to zoom, drag to move,
// double-click to zoom in or back out, or use the buttons and keys.
export function ZoomablePhoto({ src, alt }: { src: string; alt: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(FIT)
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())

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
      const [px, py] = fromCentre(event.clientX, event.clientY)
      const factor = Math.exp(-event.deltaY * 0.002)
      setView((v) => zoomAt(v, v.scale * factor, px, py, rect()))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const all = pointers.current
    const last = all.get(event.pointerId)
    if (!last) return
    const now = { x: event.clientX, y: event.clientY }
    if (all.size === 1) {
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
  }
  const onDoubleClick = (event: React.MouseEvent) => {
    const [px, py] = fromCentre(event.clientX, event.clientY)
    setView((v) => (v.scale > 1 ? FIT : zoomAt(v, 2.5, px, py, rect())))
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
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
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <IconButton
          icon="zoom-out"
          label="Zoom out"
          size="sm"
          variant="outline"
          disabled={view.scale <= MIN}
          onClick={() => zoomBy(1 / STEP)}
        />
        <span
          aria-live="polite"
          style={{
            minWidth: '48px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--text-secondary)',
          }}
        >
          {Math.round(view.scale * 100) + '%'}
        </span>
        <IconButton
          icon="zoom-in"
          label="Zoom in"
          size="sm"
          variant="outline"
          disabled={view.scale >= MAX}
          onClick={() => zoomBy(STEP)}
        />
        <IconButton
          icon="scan"
          label="Fit to window"
          size="sm"
          variant="outline"
          disabled={view.scale === MIN}
          onClick={() => setView(FIT)}
        />
        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
          {view.scale > 1 ? 'Drag to move' : 'Scroll or double-click to zoom'}
        </span>
      </div>
      <div
        ref={frame}
        tabIndex={0}
        aria-label={alt + '. Use plus and minus to zoom, arrow keys to move, 0 to fit.'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          height: 'min(70svh, 720px)',
          overflow: 'hidden',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
          cursor: view.scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
    </div>
  )
}
