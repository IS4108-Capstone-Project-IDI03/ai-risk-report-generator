// Draws whatever the walkthrough engine says (F-12): the dimming with its cut-out, MarshBot's bubble
// beside it (or centred, or in the corner; a bottom sheet on a phone), and the "Your turn" ring.
// Mounted once in App.tsx's Workspace. Calls engine.ts, player.ts (next, back, skip), Highlight, WalkthroughBubble.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone } from '../../design-system'
import type { AssessmentWorkflow } from '../assessments/useAssessmentWorkflow'
import type { Session } from '../auth/api'
import '../marshbot/marshbot.css'
import '../marshbot/components/thread/thread.css'
import { canPlay, isRunning, play, startEngine } from './engine'
import { back, next, skip } from './player'
import { findTarget } from './settle'
import { calm, useWalkthroughs } from './state'
import { Highlight, type Box } from './components/Highlight'
import {
  apartBoxes,
  bringIntoView,
  clipBox,
  placeBubble,
  roomFor,
  scrollerOn,
  sheetSide,
  uncover,
  visibleY,
} from './placement'
import { WalkthroughBubble } from './components/WalkthroughBubble'
import './walkthrough.css'

/** Keeps the last non-null value for `ms` after it goes, so it can fade out; returns it and whether it is leaving. */
function useLinger<T>(value: T | null, ms: number): [T | null, boolean] {
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

// Where the layer goes: the open modal dialog, if any (else the body). A modal dialog sits in the
// browser's top layer and makes everything outside it inert, so a layer in the body would sit
// under it, unreachable (the same reason as design-system Sheet's sheetHost).
function layerHost(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([inert])')
  return dialogs[dialogs.length - 1] ?? document.body
}

type Measured = { box: Box; each: Box[] }

/** Returns the box round every tagged element (viewport px), clipped to the window, and each
    element's own clipped box (for a step that lights them one by one); null if one is missing. */
function measure(key: string): Measured | null {
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
const measureBox = (key: string): Box | null => measure(key)?.box ?? null

const same = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

/** Returns measure() for the tags, kept up to date on scroll and resize. */
function useTargetBox(tags: string[] | null): Measured | null {
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
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
    }
  }, [key])
  return got
}

/** Marks each element the highlight goes round with `data-walk-on` (types.ts), so a screen's CSS can
    keep hover-only controls showing while MarshBot points at them; removed when the step changes or ends. */
function useMarkTargets(tags: string[] | null, box: Box | null) {
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
    return () => els.forEach((el) => el.removeAttribute('data-walk-on'))
  }, [key, box])
}

/** Returns the walkthrough layer; nothing while no walkthrough, offer or message shows. */
export function WalkthroughHost({
  session,
  workflow,
}: {
  session: Session
  workflow: AssessmentWorkflow
}) {
  useEffect(() => startEngine(session), [session])
  // Development only (tree-shaken from the build): lets playwright replay a walkthrough, e.g.
  // window.__walkthroughs.play(['clients']), for definition authors and the rehearsal script.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__walkthroughs = { play, canPlay, isRunning, state: () => useWalkthroughs.getState() }
    return () => void delete w.__walkthroughs
  }, [])
  const { bubble, targets, apart, end, dim, ring, nav, running } = useWalkthroughs()
  const phone = useIsPhone()
  const quiet = calm()
  const measured = useTargetBox(targets)
  const box = measured?.box ?? null
  // A step that lights its targets one by one: a cut-out each (joined where two would touch).
  const holes = apart && measured && measured.each.length > 1 ? apartBoxes(measured.each) : null
  useMarkTargets(targets, box)
  const [view, leaving] = useLinger(bubble, dim ? 100 : 150)
  const [dimShown, ending] = useLinger(dim ? true : null, 150)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<CSSProperties>({})

  // a. The layer follows the open modal dialog (Sheet's rule), re-read when one opens or closes.
  const [host, setHost] = useState(layerHost)
  const showing = !!(view || dimShown)
  useEffect(() => {
    if (!showing) return
    const look = () => setHost(layerHost())
    look()
    const watch = new MutationObserver(look)
    // childList too: a dialog the layer sits in can be removed from the page without closing first.
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open', 'inert'],
    })
    return () => watch.disconnect()
  }, [showing])

  // b. On a phone, a sidebar step opens the navigation drawer first, and closes it after.
  const openedNav = useRef(false)
  useEffect(() => {
    if (phone && nav && !workflow.navOpen) {
      openedNav.current = true
      workflow.openNav()
    } else if ((!nav || !phone) && openedNav.current) {
      openedNav.current = false
      workflow.closeNav()
    }
  }, [phone, nav, workflow])

  // c. Places the bubble once its size is known. On a phone the page scrolls the highlight above the
  // sheet; a control that cannot scroll up (pinned to the bottom edge) gets the sheet at the top.
  const [side, setSide] = useState<'bottom' | 'top'>('bottom')
  // What the cut-out shows: on a desktop, only the part of the box the bubble leaves free.
  const [drawn, setDrawn] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (!el || !view) return
    const win = { w: window.innerWidth, h: window.innerHeight }
    if (!phone) {
      const size = { w: el.offsetWidth, h: el.offsetHeight }
      const part = box && view.place === 'target' ? roomFor(box, size, win) : box
      setDrawn((old) => (same(old, part) ? old : part))
      return setSpot(placeBubble(view.place, part, size, win))
    }
    setDrawn(box)
    // Measured now, not from `box`: when a step changes, `box` is still the step before's for one
    // render, and scrolling by it would push the new target out of view.
    const els = (targets ?? []).map(findTarget).filter((t) => t !== null)
    if (!els.length) return setSide('bottom')
    const rects = els.map((t) => t.getBoundingClientRect())
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    const sheet = el.offsetHeight
    const room = win.h - sheet - 16
    // Only a real scroll container moves (never an overflow: hidden one); none = the sheet goes up.
    const scroller = scrollerOn(els[0], 'y')
    // A target taller than the room above the sheet stays where the step put it (its start in
    // view) with the sheet at the bottom. Shown from its end, that end goes above the sheet.
    if (bottom - top + 12 > room - 16) {
      if (top < 0 && bottom <= win.h && bottom + 6 > room)
        scroller?.scrollBy?.({ top: bottom + 6 - room })
      // The cut-out stops above the sheet (as a desktop bubble's roomFor does): lit page showing
      // round the sheet's corners would look like part of the sheet.
      if (box && box.y + box.h + 6 > room) setDrawn({ ...box, h: Math.max(room - 6 - box.y, 0) })
      return setSide('bottom')
    }
    if (bottom + 6 > room) scroller?.scrollBy?.({ top: bottom + 6 - room })
    else if (top - 6 < 16) scroller?.scrollBy?.({ top: top - 22 })
    // A pinned bar (the document editor's header) may now sit over the target's top: it is
    // scrolled clear again, and what then sits under the sheet moves the sheet to the top instead.
    uncover(els, win, ['top'])
    setSide(sheetSide(measureBox((targets ?? []).join('|')), sheet, win.h))
  }, [view, box, phone, targets])

  // c2. Something else may scroll the target away after the step has shown (MarshBot's conversation
  // follows its newest message while it types, and can push a card under the pinned tab row): once
  // the scrolling has been quiet, the target is put back in view. It moves nothing that is in view.
  useEffect(() => {
    if (!targets) return
    let timer = 0
    const check = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const els = targets.map(findTarget).filter((t) => t !== null)
        if (els.length) bringIntoView(els, { w: window.innerWidth, h: window.innerHeight }, end)
      }, 400)
    }
    window.addEventListener('scroll', check, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', check, true)
    }
  }, [targets, end])

  // d. Focus goes into the bubble with each step, and back where it was when the walkthrough ends.
  const returnTo = useRef<Element | null>(null)
  useEffect(() => {
    if (running && !returnTo.current) returnTo.current = document.activeElement
    if (!running && returnTo.current) {
      ;(returnTo.current as HTMLElement).focus?.()
      returnTo.current = null
    }
  }, [running])
  useEffect(() => {
    if (running && bubble) bubbleRef.current?.focus({ preventScroll: true })
  }, [running, bubble?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // e. Keys: Esc skips, Right and Left step (not while typing in a field).
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      const at = e.target
      const bubbleEl = bubbleRef.current
      // Arrows step only from the bubble (or with nothing in focus): anywhere else they belong to
      // the control in focus (a field, a select, a tab row the step asked the person to use).
      const mine = !(at instanceof Element) || at === document.body || !!bubbleEl?.contains(at)
      if (e.key === 'Escape') {
        // Without this, Esc would also close a dialog the step points into.
        e.preventDefault()
        e.stopPropagation()
        skip()
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        // Cmd+Left and the like are the browser's own (Back, word jumps): never a step.
      } else if (e.key === 'ArrowRight' && mine) next()
      else if (e.key === 'ArrowLeft' && mine) back()
      else if (e.key === 'Tab' && bubbleEl) {
        // While the page is dimmed and only told about, Tab stays in the bubble: the dimming blocks
        // the pointer, and without this the keyboard could still press what is behind it. A
        // hands-on step and a bare bubble leave the page to the person.
        const { dim: dimmed, ring: turn, targets: lit } = useWalkthroughs.getState()
        const stops = [...bubbleEl.querySelectorAll<HTMLElement>('button:not([disabled])')]
        const from = document.activeElement
        // "Your turn": Tab from the bubble's last button goes to the highlighted control, which
        // the keyboard could not otherwise reach from here (the bubble sits at the end of the page).
        if (dimmed && turn !== 'off') {
          const leaving = !e.shiftKey && bubbleEl.contains(from)
          const lastStop = from === stops[stops.length - 1] || from === bubbleEl || !stops.length
          const target = lit?.[0] ? findTarget(lit[0]) : null
          const first = target?.matches('button, a[href], input, select, textarea, [tabindex]')
            ? target
            : target?.querySelector<HTMLElement>('button, a[href], input, select, textarea')
          if (!leaving || !lastStop || !first) return
          e.preventDefault()
          return first.focus()
        }
        if (!dimmed) return
        const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
        if (bubbleEl.contains(from) && from !== edge && !(e.shiftKey && from === bubbleEl)) return
        e.preventDefault()
        ;(e.shiftKey ? stops[stops.length - 1] : stops[0])?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [running])

  if (!showing) return null
  const handsOn = ring !== 'off'
  return createPortal(
    <Layer>
      {dimShown && (
        <div className="wt-shade" data-leaving={ending || undefined}>
          <Highlight
            box={view ? drawn : box}
            holes={holes}
            glideKey={targets?.join('|') ?? ''}
            ring={ring}
            passThrough={handsOn}
            calm={quiet}
          />
        </div>
      )}
      {view && (
        <WalkthroughBubble
          key={view.key}
          ref={bubbleRef}
          view={view}
          instant={quiet}
          leaving={leaving}
          onBack={back}
          onNext={() => next()}
          onSkip={skip}
          modal={dim && !handsOn}
          dock={phone ? side : undefined}
          style={phone ? undefined : spot}
        />
      )}
    </Layer>,
    host,
  )
}

// Without popover support (jsdom) the attribute alone would hide the layer for good.
const POPOVERS = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

// The layer itself: a manual popover, so the browser shows it in the top layer, above the page and
// any open dialog (jsdom has no popovers; there it is a plain fixed layer).
function Layer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    // Only a connected element can open: the dialog the layer sat in may have just been removed
    // (the host moves the layer out on its next look), and a throw here would take the app down.
    if (el?.showPopover && el.isConnected && !el.matches(':popover-open')) el.showPopover()
  }, [])
  return (
    <div ref={ref} className="wt-layer" popover={POPOVERS ? 'manual' : undefined}>
      {children}
    </div>
  )
}
