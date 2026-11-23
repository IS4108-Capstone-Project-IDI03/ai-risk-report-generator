// The walkthrough host's measuring hooks (F-12): where the lit targets are (kept up to date on
// scroll, resize and each new step), marking them with data-walk-on, and keeping a value on screen
// while it fades out. Called by WalkthroughHost. Calls settle.ts (findTarget) and placement.ts.
import { useEffect, useState } from 'react'
import { clipBox, scrollerOn, visibleY, type Box } from './placement'
import { findTarget } from './settle'

/** Keeps the last non-null value for `ms` after it goes, so it can fade out; returns it and whether it is leaving. */
export function useLinger<T>(value: T | null, ms: number): [T | null, boolean] {
  const [kept, setKept] = useState(value)
  if (value !== null && value !== kept) setKept(value)
  const leaving = value === null && kept !== null
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setKept(null), ms)
    return () => clearTimeout(timer)
  }, [leaving, ms])
  return [value ?? kept, leaving]
}

export type Measured = { box: Box; each: Box[] }

/** Returns the box round every tagged element (viewport px), clipped to the window, and each
    element's own clipped box (for a step that lights them one by one); null if one is missing. */
export function measure(key: string): Measured | null {
  const els = key ? key.split('|').map(findTarget) : []
  if (!els.length || !els.every(Boolean)) return null
  // Each target is cut to what its own scroller shows, so a union taller than a panel's body does
  // not light the panel's header or footer as well.
  const rects = (els as HTMLElement[]).map((el) => {
    const r = el.getBoundingClientRect()
    const scroller = scrollerOn(el, 'y')
    if (!scroller) return r
    const [vTop, vBottom] = visibleY(scroller, { w: window.innerWidth, h: window.innerHeight })
    const top = Math.min(Math.max(r.top, vTop), vBottom)
    return { left: r.left, right: r.right, top, bottom: Math.max(Math.min(r.bottom, vBottom), top) }
  })
  const win = { w: window.innerWidth, h: window.innerHeight }
  const x = Math.min(...rects.map((r) => r.left))
  const y = Math.min(...rects.map((r) => r.top))
  const w = Math.max(...rects.map((r) => r.right)) - x
  const h = Math.max(...rects.map((r) => r.bottom)) - y
  const each = rects
    .map((r) => clipBox({ x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }, win))
    .filter((b) => b.w > 0 && b.h > 0)
  return { box: clipBox({ x, y, w, h }, win), each }
}

/** Returns the box round the tags, as measure() gives it; null if one is missing. */
export const measureBox = (key: string): Box | null => measure(key)?.box ?? null

export const same = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

// Raised after the targets are marked: a screen's CSS keyed on data-walk-on can change its layout
// then (Split note's compact parts), with no scroll or resize to say so.
const MARKED = 'walkthrough-marked'

/** Returns measure() for the tags, kept up to date on scroll, resize and marking. A new list (a new step or
    action) is measured again even with the same tags: MarshBot's newest message is a new element
    by then, and without this the cut-out would stay where the old one was. */
export function useTargetBox(tags: string[] | null): Measured | null {
  const [got, setGot] = useState<Measured | null>(null)
  const key = tags?.join('|') ?? ''
  useEffect(() => {
    const look = () => {
      const now = measure(key)
      // Same numbers, same object: without this, every scroll event would re-render the layer.
      setGot((old) => (JSON.stringify(old) === JSON.stringify(now) ? old : now))
    }
    look()
    let frame = 0
    const later = () => (cancelAnimationFrame(frame), (frame = requestAnimationFrame(look)))
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    window.addEventListener(MARKED, later)
    // A target that slides in (the phone's navigation drawer) moves with no scroll: measured mid-way,
    // its cut-out was a sliver at the edge. Our own layer's motions (the letters) are left out.
    const moved = (e: Event) => !(e.target as Element).closest?.('.wt-layer') && later()
    window.addEventListener('transitionend', moved, true)
    window.addEventListener('animationend', moved, true)
    return () => {
      window.removeEventListener('transitionend', moved, true)
      window.removeEventListener('animationend', moved, true)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
      window.removeEventListener(MARKED, later)
    }
  }, [key, tags])
  return got
}

/** Marks each element the highlight goes round with `data-walk-on` (types.ts), so a screen's CSS can
    keep hover-only controls showing while MarshBot points at them; removed when the step changes or ends. */
export function useMarkTargets(tags: string[] | null, box: Box | null) {
  const key = tags?.join('|') ?? ''
  // Re-run when the box moves too: by then a re-render may have put a new element under the tag.
  useEffect(() => {
    const els = key
      ? key
          .split('|')
          .map(findTarget)
          .filter((el) => el !== null)
      : []
    els.forEach((el) => el.setAttribute('data-walk-on', ''))
    if (els.length) window.dispatchEvent(new Event(MARKED))
    return () => els.forEach((el) => el.removeAttribute('data-walk-on'))
  }, [key, box])
}
