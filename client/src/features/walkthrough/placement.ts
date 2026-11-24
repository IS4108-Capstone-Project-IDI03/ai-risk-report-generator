// Where the highlight and MarshBot's bubble go (F-12): the cut-out clipped to the window, the bubble
// beside the visible part, whole rows beside a phone sheet, and scrolling a target into view.
// Called by WalkthroughHost and step.ts. Calls nothing.
/** A box in window px. */
export type Box = { x: number; y: number; w: number; h: number }

type Size = { w: number; h: number }
export const PAD = 6 // the cut-out's room round its target (driver.js stagePadding, spotlight.ts)
const GAP = 16 // between the cut-out and the bubble
const EDGE = 16 // the bubble keeps this far from the window's edges

/** Returns the part of the box inside the window, kept 12 px in, so its cut-out (box + 6 px) is
    always framed by 6 px of dimming even when the target is wider or taller than the window. */
export function clipBox(box: Box, win: Size): Box {
  const inset = PAD * 2
  const x = Math.max(box.x, inset)
  const y = Math.max(box.y, inset)
  const w = Math.min(box.x + box.w, win.w - inset) - x
  const h = Math.min(box.y + box.h, win.h - inset) - y
  return { x, y, w: Math.max(w, 0), h: Math.max(h, 0) }
}

/** Returns the bubble's position: 16 px beside the cut-out (right, else left, below, above), never
    over it and never off the window; cards centred; corner messages 24 px in from the bottom right. */
export function placeBubble(
  place: 'target' | 'card' | 'corner' | 'bare',
  box: Box | null,
  size: Size,
  win: Size,
): { left: number; top: number } | { right: number; bottom: number } {
  if (place === 'card') return { left: (win.w - size.w) / 2, top: (win.h - size.h) / 2 }
  if (place === 'corner' || !box) return { right: 24, bottom: 24 }
  const [l, t, r, b] = [box.x - PAD, box.y - PAD, box.x + box.w + PAD, box.y + box.h + PAD]
  const y = Math.max(EDGE, Math.min(t, win.h - size.h - EDGE))
  const x = Math.max(EDGE, Math.min(l, win.w - size.w - EDGE))
  if (r + GAP + size.w <= win.w - EDGE) return { left: r + GAP, top: y }
  if (l - GAP - size.w >= EDGE) return { left: l - GAP - size.w, top: y }
  if (b + GAP + size.h <= win.h - EDGE) return { left: x, top: b + GAP }
  if (t - GAP - size.h >= EDGE) return { left: x, top: t - GAP - size.h }
  return { right: 24, bottom: 24 }
}

/** Returns the part of the highlight to draw beside a bubble of `size`: the whole box when the bubble
    fits beside it, else its top part, leaving room for the bubble below it (a month grid as wide and
    tall as the window), so the bubble never sits over the highlight. */
export function roomFor(box: Box, size: Size, win: Size): Box {
  if (!('right' in placeBubble('target', box, size, win))) return box
  const bottom = win.h - EDGE - size.h - GAP - PAD
  return bottom - box.y >= 40 ? { ...box, h: Math.min(box.h, bottom - box.y) } : box
}

/** Returns each box cut to `area` (the part of a highlight the bubble leaves free, roomFor), less any
    left empty: a step lighting its targets one by one, round a union too big for the bubble to sit
    beside, then lights less rather than have the bubble over a cut-out. */
export function cutTo(boxes: Box[], area: Box): Box[] {
  return boxes
    .map((b) => {
      const x = Math.max(b.x, area.x)
      const y = Math.max(b.y, area.y)
      const w = Math.min(b.x + b.w, area.x + area.w) - x
      const h = Math.min(b.y + b.h, area.y + area.h) - y
      return { x, y, w, h }
    })
    .filter((b) => b.w > 0 && b.h > 0)
}

/** Returns the nearest box that really scrolls on that axis (overflow auto or scroll, with more
    to show), else the page if nothing hides its overflow, else null. Never an `overflow: hidden`
    box: scrolling one (as scrollIntoView does) shifts the whole app shell and leaves a blank band. */
export function scrollerOn(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  const more = (p: HTMLElement) =>
    axis === 'y' ? p.scrollHeight > p.clientHeight : p.scrollWidth > p.clientWidth
  const overflow = (p: HTMLElement) => getComputedStyle(p)[axis === 'y' ? 'overflowY' : 'overflowX']
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
    if (/(auto|scroll)/.test(overflow(p)) && more(p)) return p
  const root = document.scrollingElement as HTMLElement | null
  const pageHides = [document.documentElement, document.body].some((p) => overflow(p) === 'hidden')
  return root && !pageHides && more(root) ? root : null
}

/** Scrolls the targets into view on both axes, cut-out padding included, moving only real scroll
    containers, from the nearest one outward (a panel's body, then the page). One cut off sideways
    goes to the inline centre; a union taller than what its scroller shows goes to its top (or its
    end, when `end`: the words are about what is at the bottom); else to the centre. Last, an edge
    left under a pinned bar is scrolled clear of it. */
export function bringIntoView(els: HTMLElement[], win: Size, end = false): void {
  const rects = els.map((el) => el.getBoundingClientRect())
  const sideways = els.findIndex((_, i) => rects[i].left - PAD < 0 || rects[i].right + PAD > win.w)
  if (sideways >= 0) {
    const r = rects[sideways]
    const scroller = scrollerOn(els[sideways], 'x')
    // Only something that fits: a table wider than its box stays at its start, as centring it
    // would hide its first columns.
    if (scroller && r.width <= scroller.clientWidth)
      scroller.scrollBy?.({ left: (r.left + r.right) / 2 - win.w / 2 })
  }
  const top0 = Math.min(...rects.map((r) => r.top))
  let from: HTMLElement | null = els[rects.findIndex((r) => r.top === top0)]
  let tall = false
  for (let level = 0; from && level < 4; level++) {
    const scroller: HTMLElement | null = scrollerOn(from, 'y')
    if (!scroller) break
    const now = els.map((el) => el.getBoundingClientRect())
    const top = Math.min(...now.map((r) => r.top))
    const bottom = Math.max(...now.map((r) => r.bottom))
    // What the scroller shows: the window for the page, else the scroller's own box (a panel's body
    // under its header). Measured against the window, a tall union's top would hide under that header.
    const [vTop, vBottom] = visibleY(scroller, win)
    if (bottom - top > vBottom - vTop - EDGE * 2) {
      tall = true
      scroller.scrollBy?.({ top: end ? bottom - vBottom + EDGE : top - vTop - EDGE })
    } else if (top - PAD < vTop || bottom + PAD > vBottom)
      scroller.scrollBy?.({ top: (top + bottom) / 2 - (vTop + vBottom) / 2 })
    from = scroller === document.scrollingElement ? null : scroller
  }
  // A union too tall to show whole keeps the edge it was scrolled to; the other is cut on purpose.
  uncover(els, win, tall ? (end ? ['bottom'] : ['top']) : ['bottom', 'top'])
}

// The nearest pinned box (position sticky or fixed) holding `hit`, unless it also holds the target.
function pinnedOver(hit: Element, target: HTMLElement): HTMLElement | null {
  for (let p: Element | null = hit; p && p !== document.body; p = p.parentElement) {
    if (p.contains(target)) return null
    if (/(sticky|fixed)/.test(getComputedStyle(p).position)) return p as HTMLElement
  }
  return null
}

// A pinned bar (a form's Cancel and Create, an editor's toolbar) can sit over a target that is inside
// the window, where no scroll would otherwise happen: the covered edge is scrolled clear of the bar.
export function uncover(els: HTMLElement[], win: Size, edges: ('bottom' | 'top')[]): void {
  if (!document.elementsFromPoint) return // jsdom lays nothing out
  for (const edge of edges) {
    const rects = els.map((el) => el.getBoundingClientRect())
    const at =
      edge === 'bottom'
        ? rects.reduce((best, r, i) => (r.bottom > rects[best].bottom ? i : best), 0)
        : rects.reduce((best, r, i) => (r.top < rects[best].top ? i : best), 0)
    const r = rects[at]
    const x = Math.min(Math.max((r.left + r.right) / 2, 1), win.w - 1)
    const y = edge === 'bottom' ? Math.min(r.bottom, win.h) - 2 : Math.max(r.top, 0) + 2
    // Past our own layer and driver.js's dimming: the dimming is hit only outside the cut-out, so
    // without skipping it a bar was found on one pass and not the next, and the page scrolled to
    // and fro for ever (Knowledge base's review choices on a phone).
    const hit = document
      .elementsFromPoint(x, y)
      .find((n) => !n.closest('.wt-layer, .driver-overlay'))
    const bar = hit && !els[at].contains(hit) ? pinnedOver(hit, els[at]) : null
    if (!bar) continue
    const b = bar.getBoundingClientRect()
    scrollerOn(els[at], 'y')?.scrollBy?.({
      top: edge === 'bottom' ? r.bottom + PAD - b.top : r.top - PAD - b.bottom,
    })
  }
}

/** Returns the boxes to cut out when a step lights its targets one by one: any two whose cut-outs
    (box + 6 px) would touch are joined into one box, since two holes drawn over each other would
    dim the part they share. */
export function apartBoxes(boxes: Box[]): Box[] {
  const out = boxes.map((b) => ({ ...b }))
  const touch = (a: Box, b: Box) =>
    a.x - PAD * 2 < b.x + b.w &&
    b.x - PAD * 2 < a.x + a.w &&
    a.y - PAD * 2 < b.y + b.h &&
    b.y - PAD * 2 < a.y + a.h
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      if (touch(out[i], out[j])) {
        const [a, b] = [out[i], out[j]]
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        out[i] = {
          x,
          y,
          w: Math.max(a.x + a.w, b.x + b.w) - x,
          h: Math.max(a.y + a.h, b.y + b.h) - y,
        }
        out.splice(j, 1)
        // The joined box may now touch one that neither part did: start again.
        i = -1
        break
      }
  return out
}

/** Returns the top and bottom (window px) of what a scroller shows: the whole window for the page. */
export function visibleY(scroller: HTMLElement, win: Size): [number, number] {
  if (scroller === document.scrollingElement) return [0, win.h]
  const r = scroller.getBoundingClientRect()
  return [Math.max(r.top, 0), Math.min(r.bottom, win.h)]
}

/** Scrolls the target's top to the top of what its scroller shows (a dialog's body, under its
    header), then clear of any pinned bar there (the phone's tab row); returns nothing. Without the
    second part the headings a step names sat under the sticky header, unseen. */
export function toTop(els: HTMLElement[], scroller: HTMLElement, top: number, win: Size) {
  const [vTop] = visibleY(scroller, win)
  if (Math.abs(top - (vTop + 22)) > 1) scroller.scrollBy?.({ top: top - (vTop + 22) })
  uncover(els, win, ['top'])
}

// A block at least half as wide as the target and no taller than this is one row: nothing inside it
// is an edge a cut-out may stop at.
const ROW_MAX = 120

// The target's rows (window px), each the outermost such block: a row inside a row is no row.
function rowsOf(targets: HTMLElement[], box: Box): DOMRect[] {
  const rows: DOMRect[] = []
  const rowEls: Element[] = []
  // Document order: a block comes before what is inside it.
  const blocks = targets.flatMap((t) => [t, ...t.querySelectorAll<HTMLElement>('*')]).slice(0, 600)
  for (const el of blocks) {
    if (rowEls.some((row) => row.contains(el))) continue
    const r = el.getBoundingClientRect()
    if (r.width < box.w / 2 || !r.height || r.height > ROW_MAX) continue
    rowEls.push(el)
    rows.push(r)
  }
  return rows
}

/** Returns the height of `box` (round the lit targets, from its top) down to its last whole row above
    `limit` and inside the box (what the target's scroller shows): a row that crosses the edge is
    left out whole. A target with no rows is lit down to the limit. */
export function wholeRowsTo(targets: HTMLElement[], box: Box, limit: number): number {
  const end = Math.min(limit, box.y + box.h)
  const rows = rowsOf(targets, box).filter((r) => r.top >= box.y - 1)
  if (!rows.length) return Math.max(end - box.y, 0)
  let edge = Math.max(box.y, ...rows.filter((r) => r.bottom <= end).map((r) => r.bottom))
  // Never inside a row: one that straddles the edge moves it up to that row's top.
  for (let moved = true; moved;) {
    moved = false
    for (const r of rows)
      if (r.top < edge - 1 && r.bottom > edge + 1) {
        edge = r.top
        moved = true
      }
  }
  return Math.max(edge - box.y, 0)
}

/** Returns where `box` starts when it is lit from its first whole row below `limit` to its end (a
    target shown from its end, under a sheet at the top): a row that crosses the edge is left out
    whole. A target with no rows starts at the limit. */
export function wholeRowsFrom(targets: HTMLElement[], box: Box, limit: number): number {
  const end = box.y + box.h
  const start = Math.max(limit, box.y)
  const rows = rowsOf(targets, box).filter((r) => r.bottom <= end + 1)
  if (!rows.length) return Math.min(start, end)
  let edge = Math.min(end, ...rows.filter((r) => r.top >= start).map((r) => r.top))
  for (let moved = true; moved;) {
    moved = false
    for (const r of rows)
      if (r.top < edge - 1 && r.bottom > edge + 1) {
        edge = r.bottom
        moved = true
      }
  }
  return Math.min(edge, end)
}

/** Returns the height, at most `max`, at which a phone sheet's last whole line of words ends just
    above its foot (Back and Next): a capped sheet is cut between two lines, never through one. */
export function betweenLines(sheet: HTMLElement, max: number): number {
  const text = sheet.querySelector('.wt-text')
  const foot = sheet.querySelector('.wt-foot')
  if (!text || !foot || !Range.prototype.getClientRects) return max // jsdom lays nothing out
  const top = sheet.getBoundingClientRect().top - sheet.scrollTop
  const under =
    foot.getBoundingClientRect().height + parseFloat(getComputedStyle(sheet).paddingBottom)
  const range = document.createRange()
  range.selectNodeContents(text)
  const ends = [...range.getClientRects()]
    .map((r) => r.bottom - top + under)
    .filter((h) => h <= max)
  return ends.length ? Math.max(...ends) : max
}
