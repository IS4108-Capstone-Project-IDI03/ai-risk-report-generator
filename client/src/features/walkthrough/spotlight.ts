// The spotlight (F-12): driver.js draws the dimming (--scrim) with one rounded cut-out round the
// target (+6 px, radius 10) and glides it between targets on one screen; between screens the cut-out
// fades shut and open under a "plug" of dimming. Only driver.js's drawing is used: MarshBot's
// bubble, the keys, focus and what can be pressed stay WalkthroughHost's.
// Called by WalkthroughHost. Calls driver.js.
import { driver, type Config, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { PAD, type Box } from './placement'

const RADIUS = 10
const GLIDE_MS = 320 // motion row 4
const LEAVE_MS = 150 // motion row 10; matches .driver-overlay[data-leaving] in walkthrough.css
export const SHUT_MS = 120 // motion row 5: the cut-out fades shut as the screen changes...
const OPEN_MS = 180 // ...and fades open once the new screen has settled
// Where a step with nothing to light (a card) puts its stand-in: off the window, so its cut-out
// (12 px with the padding) never shows. driver.js's own "nothing" stand-in sits in the body, which
// would pull the dimming out of an open dialog's layer and leave the dialog undimmed.
const NOWHERE: Box = { x: -100, y: -100, w: 0, h: 0 }

const CONFIG: Config = {
  overlayColor: 'var(--scrim)',
  overlayOpacity: 1,
  stagePadding: PAD,
  stageRadius: RADIUS,
  duration: GLIDE_MS,
  // Drawing only. allowPageInteraction also turns off its Tab trap, which would hold focus on the
  // target and never let it reach our bubble (driver.js knows only its own popover).
  allowPageInteraction: true,
  allowKeyboardControl: false, // Esc, Left and Right are the engine's
  allowClose: false,
  overlayClickBehavior: 'none',
  scrollIntoView: false, // placement.ts scrolls, through every scroll container
}

export type Spot = {
  key: string // the lit tags: a new key on the same screen glides
  box: Box | null // the cut-out's box; null = none (a card, or between screens)
  holes: Box[] | null // an `apart` step: one cut-out each
  open: Box[] // where presses go through; [] = the whole page is blocked (a tell step)
  host: HTMLElement // the walkthrough layer (WalkthroughHost)
  calm: boolean // reduced motion: no glide
}

let drv: Driver | null = null
let last: Spot | null = null
let leaving = 0
// driver.js highlights one element: these stand-ins sit where the cut-out goes (a union of tags,
// clipped to the window, kept above the phone sheet). Two, because it glides only between two
// different elements.
let stands: HTMLElement[] = []
let at = 0
let block: HTMLElement | null = null
// The plug: dimming laid over the cut-out(s) only, faded in to close them and out to open them, so
// the dimming round them never changes. `shut` = it covers the cut-out now (between screens).
let plug: HTMLElement | null = null
let shut = false
let plugTurn = 0 // bumped by each fade; a delayed fade-out for an older one does nothing
// An `apart` step's other cut-outs, added to driver.js's path whenever it redraws it.
let path: Element | null = null
let base = ''
let extra = ''
const watch = new MutationObserver(() => {
  const d = path?.getAttribute('d') ?? ''
  if (d === base + extra) return // our own write
  base = d
  if (extra) path!.setAttribute('d', base + extra)
})

// The rounded rectangle round a box grown by PAD, as driver.js draws its own cut-out.
function roundRect({ x, y, w, h }: Box) {
  const [l, t, W, H] = [x - PAD, y - PAD, w + PAD * 2, h + PAD * 2]
  const r = Math.min(RADIUS, W / 2, H / 2)
  return `M${l + r} ${t}H${l + W - r}A${r} ${r} 0 0 1 ${l + W} ${t + r}V${t + H - r}A${r} ${r} 0 0 1 ${l + W - r} ${t + H}H${l + r}A${r} ${r} 0 0 1 ${l} ${t + H - r}V${t + r}A${r} ${r} 0 0 1 ${l + r} ${t}Z`
}

function stand(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  // Inline, so driver.js's `.driver-active-element { pointer-events: auto }` cannot make the
  // stand-in catch the presses meant for the control under it.
  el.style.cssText = 'position:fixed;pointer-events:none;visibility:hidden'
  return el
}

function place(el: HTMLElement, { x, y, w, h }: Box) {
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
}

// Fades the plug over these cut-outs to `opacity` in `ms`; returns nothing.
function fade(boxes: Box[], opacity: 0 | 1, ms: number) {
  plugTurn += 1
  if (!plug) return
  if (boxes.length) plug.style.clipPath = `path("${boxes.map(roundRect).join('')}")`
  plug.style.transition = ms ? `opacity ${ms}ms var(--ease-out)` : 'none'
  plug.style.opacity = String(opacity)
}

// Lights `box` through a stand-in; `glide` moves the cut-out there from the last one (320 ms).
function light(box: Box, glide: boolean) {
  if (glide) at = 1 - at
  place(stands[at], box)
  drv!.setConfig({ ...CONFIG, animate: glide })
  drv!.highlight({ element: stands[at] })
}

// After driver.js has drawn (it draws on the next frame): finds its path, so `apart` holes follow
// its redraws, and marks a card's dimming (it fades in with the card, 220 ms, not 180).
// shortcut: reads driver.js's private `__overlaySvg` state and rewrites its path, which only
// works for driver.js 1.14.0 (pinned in package.json); recheck both on any upgrade.
function attach() {
  const svg = drv?.getState('__overlaySvg') as SVGSVGElement | undefined
  const now = svg?.firstElementChild ?? null
  if (now && now !== path) {
    path = now
    base = now.getAttribute('d') ?? ''
    watch.disconnect()
    watch.observe(now, { attributeFilter: ['d'] })
    svg!.toggleAttribute('data-card', !last?.box)
  }
  if (path && path.getAttribute('d') !== base + extra) path.setAttribute('d', base + extra)
}

const same = (a: Spot, b: Spot | null) =>
  !!b &&
  a.key === b.key &&
  a.host === b.host &&
  a.calm === b.calm &&
  JSON.stringify([a.box, a.holes, a.open]) === JSON.stringify([b.box, b.holes, b.open])

/** Shows (or moves) the dimming and cut-out; returns nothing. Called with every change. */
export function showSpot(spot: Spot): void {
  if (leaving) {
    // Back before it had gone (the spotlight returns within 150 ms): it stays, and is drawn again.
    clearTimeout(leaving)
    leaving = 0
    drv?.getState('__overlaySvg')?.removeAttribute('data-leaving')
    last = null
    shut = false
  }
  if (same(spot, last)) return
  const before = last
  last = spot
  drv ??= driver(CONFIG)
  if (!stands.length) stands = [stand(), stand()]
  block ??= Object.assign(document.createElement('div'), { className: 'wt-block' })
  plug ??= Object.assign(document.createElement('div'), { className: 'wt-plug' })
  // a. In a modal dialog driver.js draws into the dialog's `:scope > .driver-layer`, else making its
  // own popover over ours (and over the bubble): our layer is made that layer.
  if (spot.host.parentElement?.closest('dialog')) spot.host.classList.add('driver-layer')
  // Before the bubble, so the block lies under it. Inside the layer, so it is above any dialog.
  // The plug after driver.js's svg (which it prepends to a dialog's layer), so it lies over it.
  if (block.parentElement !== spot.host || stands[0].parentElement !== spot.host)
    spot.host.prepend(block, ...stands, plug)
  // b. The blocking is ours: everything, or all but where presses may go (a hands-on step).
  block.style.clipPath = spot.open.length
    ? `path(evenodd, "M-99999 -99999H99999V99999H-99999Z${spot.open.map(roundRect).join('')}")`
    : ''
  // c. The cut-out: driver.js's own round the first box, the rest of an `apart` step's added.
  // Between screens (no box now, one before) it fades shut where it was instead, the dimming
  // staying, and the next one fades open (motion row 5: a plain fade, so with reduced motion too).
  const main = spot.holes?.[0] ?? spot.box
  const here = before?.host === spot.host
  if (!main && here && (before?.box || shut)) {
    // Already shut (the next step's tags are set, its box not measured yet): it stays shut.
    if (!shut) fade(before!.holes?.length ? before!.holes : [before!.box!], 1, SHUT_MS)
    shut = true
    return
  }
  extra = (spot.holes ?? []).slice(1).map(roundRect).join('')
  if (!main) {
    fade([], 0, 0)
    // Tags with no box yet (a phone's cut-out waits for its sheet): its cut-out fades open, as after a shut.
    shut = !!spot.key
    light(NOWHERE, false)
  } else if (!before?.box || before.key !== spot.key || !here) {
    const holes = spot.holes?.length ? spot.holes : [main]
    if (shut && here) {
      // Covered at once, then opened once driver.js has drawn the new cut-out under it.
      fade(holes, 1, 0)
      const turn = plugTurn
      requestAnimationFrame(() =>
        requestAnimationFrame(() => turn === plugTurn && fade(holes, 0, OPEN_MS)),
      )
    } else fade([], 0, 0)
    shut = false
    light(main, !spot.calm && !!before?.box && here)
  } else {
    // The same target moved (scroll, resize): the stand-in follows and driver.js redraws.
    place(stands[at], main)
    drv.refresh()
  }
  requestAnimationFrame(attach)
}

/** Fades the dimming out (150 ms) and then removes everything driver.js added; returns nothing. */
export function hideSpot(): void {
  if (!drv || leaving) return
  // The page is usable at once; only the dimming lingers while it fades.
  block?.remove()
  drv.getState('__overlaySvg')?.setAttribute('data-leaving', '')
  // A shut cut-out's plug fades with the dimming, or it would sit there dark for 150 ms.
  if (shut) fade([], 0, LEAVE_MS)
  leaving = window.setTimeout(() => {
    leaving = 0
    drv?.destroy()
    drv = null
    last = null
    path = null
    watch.disconnect()
    stands.forEach((el) => el.remove())
    plug?.remove()
    shut = false
  }, LEAVE_MS)
}
