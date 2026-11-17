// Scrolled away from the newest turn (AS-06 round 7, boards R7-C8, R7-M3): while the action slot
// is out of view, a slim bar at the foot of the conversation holds the same buttons, with a round
// arrow above it that scrolls to the newest turn. With no slot, the arrow shows alone once the
// thread's end is out of view. Both leave as soon as it is back. Drawn by Thread.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconButton } from '../../../../design-system'
import { useToastPlace } from './useToastPlace'

/** Returns the sticky bar and the arrow; `slot` is the action slot, `end` the thread's end mark,
    and `focusLatest` moves focus to MarshBot's newest turn. */
export function ScrolledAway({
  scroller,
  end,
  slot,
  phone,
  actions,
  onLatest,
  focusLatest,
}: {
  scroller: RefObject<HTMLDivElement | null>
  end: RefObject<HTMLDivElement | null>
  slot: HTMLDivElement | null
  phone: boolean
  actions: ReactNode | null
  onLatest: () => void
  focusLatest: () => void
}) {
  const [away, setAway] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const hasSlot = !!actions
  useToastPlace(scroller, bar, away && hasSlot)

  // a. Watch the slot's end (or the thread's end) inside what scrolls: the thread on a computer,
  //    the page on a phone (thread.css), so `phone` re-runs this when the window crosses over.
  //    The slot's end, not the whole slot: a slot taller than the view (wrapped buttons on a
  //    phone) could never be wholly in view.
  useEffect(() => {
    const el = scroller.current
    const target = hasSlot ? slot?.querySelector('.mbt-slot-end') : end.current
    if (!el || !target || typeof IntersectionObserver === 'undefined') return
    const root = getComputedStyle(el).overflowY === 'visible' ? null : el
    const watch = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) handOver()
        setAway(!e.isIntersecting)
      },
      { root },
    )
    watch.observe(target)
    return () => watch.disconnect()

    // b. Focus in the bar or on the arrow as they hide (inert) would be lost: it moves to the
    //    same button in the slot, else to MarshBot's newest turn.
    function handOver() {
      const from = document.activeElement
      if (!(from instanceof HTMLElement) || !wrap.current?.contains(from)) return
      // The slot's own buttons only: an open calendar's day buttons have no twin in the slot.
      const own = (box?: Element | null) =>
        [...(box?.querySelectorAll('button') ?? [])].filter((b) => !b.closest('.ds-popover'))
      const at = own(bar.current).indexOf(from as HTMLButtonElement)
      const same = at < 0 ? undefined : own(slot)[at]
      slot?.removeAttribute('inert')
      if (same) same.focus({ preventScroll: true })
      else focusLatest()
    }
  }, [scroller, end, slot, hasSlot, phone, focusLatest])

  // c. One set of buttons for assistive tech: the slot is inert while the bar stands in for it,
  //    and the thread keeps the bar's height clear, so a focused card button never hides under it.
  //    shortcut: not on a phone, where an outer box scrolls; add it there if keyboards matter.
  useLayoutEffect(() => {
    const el = scroller.current
    const shown = away && hasSlot
    // Focus on a slot button (a calendar's button that just closed) would be dropped to the page by
    // the slot going inert: it moves to MarshBot's newest turn, the region round the slot.
    if (shown && slot?.contains(document.activeElement)) focusLatest()
    slot?.toggleAttribute('inert', shown)
    if (!el || !shown) return
    el.style.setProperty('scroll-padding-bottom', `${bar.current?.offsetHeight ?? 0}px`)
    return () => void el.style.removeProperty('scroll-padding-bottom')
  }, [scroller, slot, away, hasSlot, focusLatest])

  return (
    // Kept mounted so it can fade both ways; out of view it is inert and hidden from readers.
    <div
      ref={wrap}
      className="mbt-away"
      data-away={away || undefined}
      data-alone={!hasSlot || undefined}
      inert={!away}
      aria-hidden={!away || undefined}
    >
      <IconButton
        icon="arrow-down"
        label="Scroll to Latest Message"
        variant="outline"
        className="mbt-latest"
        onClick={onLatest}
        // Round and 36 px (R7-C8); the button's own size is set inline, so it is set here too.
        style={{ width: 36, height: 36, borderRadius: '50%' }}
      />
      {hasSlot && (
        <div ref={bar} className="mbt-bar">
          {/* Keyed on `away`: the buttons are drawn afresh as the bar hides, so a calendar left
              open in it closes with it instead of staying open out of sight. */}
          <div key={String(away)} className="mbt-bar-in" role="group" aria-label="Your reply">
            {actions}
          </div>
        </div>
      )}
    </div>
  )
}
