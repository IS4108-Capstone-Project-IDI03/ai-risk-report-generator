// Draws whatever the walkthrough engine says (F-12): the dimming with its cut-out (driver.js, through
// spotlight.ts), MarshBot's bubble beside it (or centred, or in the corner; a bottom sheet on a
// phone), and the "Your turn" ring. Mounted once in App.tsx's Workspace.
// Calls engine.ts, player.ts (next, back, skip), spotlight.ts, targets.ts, keys.ts, Layer, WalkthroughBubble.
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
import { hideSpot, showSpot } from './spotlight'
import {
  apartBoxes,
  bringIntoView,
  cutTo,
  PAD,
  placeBubble,
  roomFor,
  scrollerOn,
  toTop,
  betweenLines,
  wholeRowsFrom,
  uncover,
  visibleY,
  wholeRowsTo,
  type Box,
} from './placement'
import { measureBox, same, useLinger, useMarkTargets, useTargetBox } from './targets'
import { Layer } from './components/Layer'
import { WalkthroughBubble } from './components/WalkthroughBubble'
import { useBubbleFocus, useWalkthroughKeys } from './keys'
import './walkthrough.css'

// The least of a target a phone lights above MarshBot's whole sheet: its heading or first row.
const FIRST_ROW = 32
// How far a target's own top may sit under MarshBot's sheet at the top: its first row's padding.
const ROW_PAD = 8

/** Returns where the layer goes: the open modal dialog, if any (else the body). A modal dialog sits
    in the browser's top layer and makes everything outside it inert, so a layer in the body would
    sit under it, unreachable (the same reason as design-system Sheet's sheetHost). */
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
  const { bubble, targets, apart, end, dim, ring, nav, running, quiet: aside } = useWalkthroughs()
  const phone = useIsPhone()
  const quiet = calm()
  const measured = useTargetBox(targets)
  const box = measured?.box ?? null
  // A step that lights its targets one by one: a cut-out each (joined where two would touch).
  const holes = apart && measured && measured.each.length > 1 ? apartBoxes(measured.each) : null
  useMarkTargets(targets, box)
  const [view, leaving] = useLinger(bubble, dim ? 100 : 150)
  // The layer stays while the dimming fades out: inside a dialog the dimming is drawn in it.
  const [dimShown] = useLinger(dim ? true : null, 150)
  const [shownRing, ringLeaving] = useLinger(ring === 'on' ? true : null, 150)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<CSSProperties>({})
  // A hands-on step has let the spotlight go (hands.ts, letGo): the page is the person's, so nothing
  // scrolls it back to the target. Not `!dim` alone: a bare walkthrough is never dimmed.
  const letGo = !dim && !!bubble?.step?.hands

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
    // Its whole height (as offsetHeight is without a cap of ours), so a cap never feeds back here.
    const sheet = Math.min(el.scrollHeight, win.h - 32)
    const room = win.h - sheet - 16
    // Only a real scroll container moves (never an overflow: hidden one).
    const scroller = scrollerOn(els[0], 'y')
    const rects = els.map((t) => t.getBoundingClientRect())
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    // 1. Into view: a target shown from its end has that end scrolled above the sheet; any other
    // whose top is hidden or whose end is under the sheet starts at the top of what its scroller
    // shows, clear of a sticky header. Never the other way round: scrolling its end up would hide
    // its top again under the header, and the two would take turns for ever.
    // A target shown from its end is never scrolled to its top: the two scrolls took turns, the
    // sheet changing side each time (Knowledge base's review choices).
    if (scroller && end && bottom + 6 > room) scroller.scrollBy?.({ top: bottom + 6 - room })
    else if (scroller && !end && (bottom + 6 > room || top - 6 < visibleY(scroller, win)[0] + 16))
      toTop(els, scroller, top, win)
    // A pinned bar (the document editor's header) may still sit over the target's top.
    uncover(els, win, ['top'])
    const seen = measureBox((targets ?? []).join('|'))
    if (!seen) return setSide('bottom')
    // A target running past what the window (or its scroller) shows is lit in whole rows on
    // screen: without this, the edge cut a row (Export's "Left to finish" at the bottom; the
    // review choices' heading, scrolled out of its panel, at the top).
    const now = els.map((t) => t.getBoundingClientRect())
    const shownEnd = seen.y + seen.h
    const start =
      Math.min(...now.map((r) => r.top)) < seen.y - 1 ? wholeRowsFrom(els, seen, seen.y) : seen.y
    const stop =
      Math.max(...now.map((r) => r.bottom)) > shownEnd + 1
        ? start + wholeRowsTo(els, { ...seen, y: start, h: shownEnd - start }, shownEnd)
        : shownEnd
    const lit =
      stop - start >= Math.min(seen.h, FIRST_ROW) ? { ...seen, y: start, h: stop - start } : seen
    // Where the target is now, after the scroll: `box` is still where it was before it.
    setDrawn({ key: view.key, box: lit })
    // 2. MarshBot's words always show whole. The sheet goes where it fits whole (below the target,
    // else above it). Else a target shown from its end (`show: 'end'`) gets the sheet at the top and
    // is lit from its first whole row under it to its end; any other gets the sheet at the bottom
    // and is lit from its top down to its last whole row above it (the top only when that shows
    // less than its first row). Rows are never cut (placement.ts, rowsOf), and a dim gap of at least
    // 8 px stays between the cut-out and the sheet. Only a target with no whole row on either side
    // keeps the sheet to the larger side, cut between two lines.
    const above = lit.y - PAD - 8
    const below = win.h - (lit.y + lit.h + PAD) - 16
    if (sheet <= below) return setSide('bottom')
    if (sheet <= above) return setSide('top')
    const enough = Math.min(lit.h, FIRST_ROW)
    const litEnd = lit.y + lit.h
    const rows = wholeRowsTo(els, lit, room - 6)
    // A target whose own top is at most ROW_PAD under a sheet at the top is lit from that top: its
    // first row's padding sits under the sheet, its words below it (the drawer's Tools list).
    const limit = lit.y >= sheet - ROW_PAD ? lit.y : sheet + PAD + 8
    const from = wholeRowsFrom(els, lit, limit)
    const atBottom = () => (
      setDrawn({ key: view.key, box: { ...lit, h: rows } }),
      setSide('bottom')
    )
    if (!end && rows >= enough) return atBottom()
    if (litEnd - from >= enough) {
      setDrawn({ key: view.key, box: { ...lit, y: from, h: litEnd - from } })
      return setSide('top')
    }
    if (rows >= enough) return atBottom()
    setSheetMax(betweenLines(el, Math.max(above, below)))
    setSide(below >= above ? 'bottom' : 'top')
  }, [view, box, phone, targets, letGo, leaving, end])

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

  // d. Focus goes into the bubble with each step and back at the end; e. the keys (keys.ts).
  useBubbleFocus(running, bubble?.key, bubbleRef)
  useWalkthroughKeys(running, bubbleRef)

  // f. driver.js draws the dimming and cut-out (spotlight.ts) into our layer's place. Once the
  // bubble is placed, the cut-out is the part it leaves free (`drawn`). A tell step blocks the whole
  // page; a hands-on one lets presses through its cut-out.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const handsOn = ring !== 'off'
  // No box (between screens) shuts the cut-out at once, not when the old bubble has faded; a new
  // message's first draw (`drawn` not yet worked out for it) uses the whole box. On a phone the
  // cut-out opens with the sheet instead: the page scrolls the target up once the sheet's height is
  // known (c), and opened before that it lit what scrolled into the target's old place.
  const placed = !!box && !!view && drawn?.key === view.key
  const spotBox = placed ? (drawn!.box ?? box) : phone ? null : box
  // Each separate cut-out only as far as the drawn part: the bubble never sits over one.
  const spotHoles = holes && spotBox ? cutTo(holes, spotBox) : holes
  const key = targets?.join('|') ?? ''
  useEffect(() => {
    if (!dim || !layer) return hideSpot()
    const open = !handsOn ? [] : (spotHoles ?? (spotBox ? [spotBox] : []))
    showSpot({ key, box: spotBox, holes: spotHoles, open, host: layer, calm: quiet })
  }, [dim, layer, key, spotBox, spotHoles, handsOn, quiet])
  // Without this, signing out mid-walkthrough would leave driver.js's dimming on the page.
  useEffect(() => hideSpot, [])

  // While the walkthrough waits on the app with nothing on screen, a screen reader hears why (the
  // spec's approved words). The line is there for the whole walkthrough, so its change is announced:
  // it sits first in one fragment whether or not the layer shows (returned alone it was made again
  // with its words already in it, which is not read out), and inside an open dialog, where the
  // rest of the page cannot be heard.
  const live = running
    ? createPortal(
        <p className="wt-live" role="status">
          {aside ? "I'll carry on when this is ready." : ''}
        </p>,
        host,
        'live',
      )
    : null
  const shown = !showing
    ? null
    : createPortal(
        <Layer ref={setLayer}>
          {/* "Your turn": a ring breathing round the cut-out (motion row 7). */}
          {shownRing && spotBox && (
            <span
              className="wt-ring"
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
              modal={dim && !handsOn}
              dock={phone ? side : undefined}
              style={phone ? (sheetMax ? { maxHeight: sheetMax } : undefined) : spot}
            />
          )}
        </Layer>,
        host,
      )
  return (
    <>
      {live}
      {shown}
    </>
  )
}
