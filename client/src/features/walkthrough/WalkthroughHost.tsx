// Draws whatever the walkthrough engine says (F-12): the dimming with its cut-out (driver.js, through
// spotlight.ts), MarshBot's bubble beside it (or centred, or in the corner; a bottom sheet on a
// phone), and the "Your turn" ring. Mounted once in App.tsx's Workspace.
// Calls engine.ts, player.ts (next, back, skip), spotlight.ts, targets.ts, WalkthroughBubble.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone } from '../../design-system'
import type { AssessmentWorkflow } from '../assessments/useAssessmentWorkflow'
import type { Session } from '../auth/api'
import '../marshbot/marshbot.css'
import '../marshbot/components/thread/thread.css'
import { canPlay, isRunning, play, startEngine } from './engine'
import { back, next, skip, typed } from './player'
import { findTarget } from './settle'
import { calm, useWalkthroughs } from './state'
import { hideSpot, showSpot } from './spotlight'
import {
  apartBoxes,
  bringIntoView,
  cutTo,
  PAD,
  placeBubble,
  roomFor,
  scrollerOn,
  sheetSide,
  uncover,
  type Box,
} from './placement'
import { measureBox, same, useLinger, useMarkTargets, useTargetBox } from './targets'
import { WalkthroughBubble } from './components/WalkthroughBubble'
import './walkthrough.css'

// The least a capped phone sheet keeps: MarshBot's row, two lines and Back and Next.
const SHEET_MIN = 180

// Where the layer goes: the open modal dialog, if any (else the body). A modal dialog sits in the
// browser's top layer and makes everything outside it inert, so a layer in the body would sit
// under it, unreachable (the same reason as design-system Sheet's sheetHost).
function layerHost(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([inert])')
  return dialogs[dialogs.length - 1] ?? document.body
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
  const { bubble, targets, press, apart, end, dim, ring, nav, running } = useWalkthroughs()
  const phone = useIsPhone()
  const quiet = calm()
  const measured = useTargetBox(targets)
  const box = measured?.box ?? null
  // A step that lights its targets one by one: a cut-out each (joined where two would touch).
  const holes = apart && measured && measured.each.length > 1 ? apartBoxes(measured.each) : null
  // The pressed control too: a hover-only one inside the target (the Category field's Confirm tick)
  // shows only while it is marked itself (cp24.css, `.cpf-decide:has([data-walk-on])`).
  useMarkTargets(press ? [...(targets ?? []), press] : targets, box)
  // A cut-out wider than the control to press (types.ts, `do`): presses reach only that control.
  const pressTags = useMemo(() => (press ? [press] : null), [press])
  const pressBox = useTargetBox(pressTags)?.box ?? null
  const [view, leaving] = useLinger(bubble, dim ? 100 : 150)
  // The layer stays while the dimming fades out: inside a dialog the dimming is drawn in it.
  const [dimShown] = useLinger(dim ? true : null, 150)
  const [shownRing, ringLeaving] = useLinger(ring === 'off' ? null : ring, 150)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<CSSProperties>({})
  // A hands-on step has let the spotlight go (player.ts, letGo): the page is the person's, so nothing
  // scrolls it back to the target. Not `!dim` alone: a bare walkthrough is never dimmed.
  const letGo = !dim && bubble?.step?.turn === 'hands'

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
  // The sheet's height when no edge leaves room for all of it beside the highlight; null = its own.
  const [sheetMax, setSheetMax] = useState<number | null>(null)
  // What the cut-out shows: on a desktop, only the part of the box the bubble leaves free.
  // Kept with the message it was worked out for: a new message's first draw has the old one's.
  const [drawn, setDrawn] = useState<{ key: string; box: Box | null } | null>(null)
  useLayoutEffect(() => {
    const el = bubbleRef.current
    // A leaving bubble keeps its place: re-placed against no box (between screens), it would jump
    // to the corner as it fades.
    if (!el || !view || leaving) return
    const win = { w: window.innerWidth, h: window.innerHeight }
    if (!phone) {
      const size = { w: el.offsetWidth, h: el.offsetHeight }
      const part = box && view.place === 'target' ? roomFor(box, size, win) : box
      setDrawn((old) =>
        old?.key === view.key && same(old.box, part) ? old : { key: view.key, box: part },
      )
      return setSpot(placeBubble(view.place, part, size, win))
    }
    setDrawn({ key: view.key, box })
    if (letGo) return
    // Measured now, not from `box`: when a step changes, `box` is still the step before's for one
    // render, and scrolling by it would push the new target out of view.
    const els = (targets ?? []).map(findTarget).filter((t) => t !== null)
    setSheetMax(null)
    if (!els.length) return setSide('bottom')
    const rects = els.map((t) => t.getBoundingClientRect())
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    // Its whole height (as offsetHeight is without a cap of ours), so a cap never feeds back here.
    const sheet = Math.min(el.scrollHeight, win.h - 32)
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
      if (box && box.y + box.h + 6 > room)
        setDrawn({ key: view.key, box: { ...box, h: Math.max(room - 6 - box.y, 0) } })
      return setSide('bottom')
    }
    if (bottom + 6 > room) scroller?.scrollBy?.({ top: bottom + 6 - room })
    else if (top - 6 < 16) scroller?.scrollBy?.({ top: top - 22 })
    // A pinned bar (the document editor's header) may now sit over the target's top: it is
    // scrolled clear again, and what then sits under the sheet moves the sheet to the top instead.
    uncover(els, win, ['top'])
    const lit = measureBox((targets ?? []).join('|'))
    if (!lit) return setSide('bottom')
    // A target that cannot scroll clear of the sheet (a group in the open navigation drawer) and
    // has room for it on neither edge: the sheet goes to the roomier edge, kept to that room, and
    // its words scroll inside it. Without this it would cover the target's top.
    const above = lit.y - PAD - 8
    const below = win.h - (lit.y + lit.h + PAD) - 16
    const edge = sheetSide(lit, sheet, win.h)
    const dock = edge === 'top' && sheet > above && below > above ? 'bottom' : edge
    const free = dock === 'top' ? above : below
    if (sheet > free) setSheetMax(Math.max(free, SHEET_MIN))
    setSide(dock)
  }, [view, box, phone, targets, letGo, leaving])

  // c2. Something else may scroll the target away after the step has shown (MarshBot's conversation
  // follows its newest message while it types, and can push a card under the pinned tab row): once
  // the scrolling has been quiet, the target is put back in view. It moves nothing that is in view.
  useEffect(() => {
    if (!targets || letGo) return
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
  }, [targets, end, letGo])

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
        const { dim: dimmed, ring: turn, targets: lit, press: only } = useWalkthroughs.getState()
        const stops = [...bubbleEl.querySelectorAll<HTMLElement>('button:not([disabled])')]
        const from = document.activeElement
        // "Your turn": Tab from the bubble's last button goes to the highlighted control (the press
        // control, when the cut-out is wider), which
        // the keyboard could not otherwise reach from here (the bubble sits at the end of the page).
        if (dimmed && turn !== 'off') {
          const leaving = !e.shiftKey && bubbleEl.contains(from)
          const lastStop = from === stops[stops.length - 1] || from === bubbleEl || !stops.length
          const target = only ? findTarget(only) : lit?.[0] ? findTarget(lit[0]) : null
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

  // f. driver.js draws the dimming and cut-out (spotlight.ts) into our layer's place. Once the
  // bubble is placed, the cut-out is the part it leaves free (`drawn`). A tell step blocks the whole
  // page; a hands-on one lets presses through its cut-out (or only its press control).
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const handsOn = ring !== 'off'
  // No box (between screens) shuts the cut-out at once, not when the old bubble has faded; a new
  // message's first draw (`drawn` not yet worked out for it) uses the whole box.
  const spotBox = box && view && drawn?.key === view.key ? (drawn.box ?? box) : box
  // Each separate cut-out only as far as the drawn part: the bubble never sits over one.
  const spotHoles = holes && spotBox ? cutTo(holes, spotBox) : holes
  const key = targets?.join('|') ?? ''
  useEffect(() => {
    if (!dim || !layer) return hideSpot()
    const open = !handsOn
      ? []
      : press
        ? pressBox
          ? [pressBox]
          : []
        : (spotHoles ?? (spotBox ? [spotBox] : []))
    showSpot({ key, box: spotBox, holes: spotHoles, open, host: layer, calm: quiet })
  }, [dim, layer, key, spotBox, spotHoles, handsOn, press, pressBox, quiet])
  // Without this, signing out mid-walkthrough would leave driver.js's dimming on the page.
  useEffect(() => hideSpot, [])

  if (!showing) return null
  return createPortal(
    <Layer ref={setLayer}>
      {/* "Your turn": a ring breathing round the cut-out; green once the action lands (motion row 7). */}
      {shownRing && spotBox && (
        <span
          className="wt-ring"
          data-done={shownRing === 'done' || undefined}
          data-leaving={ringLeaving || undefined}
          style={
            {
              left: spotBox.x - PAD,
              top: spotBox.y - PAD,
              width: spotBox.w + PAD * 2,
              height: spotBox.h + PAD * 2,
              '--sx': (spotBox.w + PAD * 2 + 12) / (spotBox.w + PAD * 2),
              '--sy': (spotBox.h + PAD * 2 + 12) / (spotBox.h + PAD * 2),
            } as CSSProperties
          }
        />
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
          onTyped={typed}
          modal={dim && !handsOn}
          dock={phone ? side : undefined}
          style={phone ? (sheetMax ? { maxHeight: sheetMax } : undefined) : spot}
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
function Layer({
  children,
  ref,
}: {
  children: React.ReactNode
  ref: (el: HTMLDivElement | null) => void
}) {
  const own = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = own.current
    // Only a connected element can open: the dialog the layer sat in may have just been removed
    // (the host moves the layer out on its next look), and a throw here would take the app down.
    if (el?.showPopover && el.isConnected && !el.matches(':popover-open')) el.showPopover()
  }, [])
  return (
    <div
      ref={(el) => {
        own.current = el
        ref(el)
      }}
      className="wt-layer"
      popover={POPOVERS ? 'manual' : undefined}
    >
      {children}
    </div>
  )
}
