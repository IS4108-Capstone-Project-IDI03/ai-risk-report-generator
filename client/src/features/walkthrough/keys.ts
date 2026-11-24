// The walkthrough's focus and keys (F-12): focus goes into each new bubble and back where it was at
// the end; Esc skips, Right and Left step, and Tab is kept to the bubble on a step that only tells.
// During a hands-on step's quiet wait (nothing of the walkthrough on screen) it takes no key at all,
// and once such a step has let its spotlight go, Esc in one of the page's controls is the page's.
// Called by WalkthroughHost. Calls player.ts (next, back, skip), settle.ts, state.ts.
import { useEffect, useRef, type RefObject } from 'react'
import { back, next, skip } from './player'
import { findTarget } from './settle'
import { useWalkthroughs } from './state'

/** Moves focus into the bubble with each new message (`key`), and back where it was when the walkthrough ends. */
export function useBubbleFocus(
  running: unknown,
  key: string | undefined,
  bubbleRef: RefObject<HTMLDivElement | null>,
) {
  const returnTo = useRef<Element | null>(null)
  useEffect(() => {
    if (running && !returnTo.current) returnTo.current = document.activeElement
    if (!running && returnTo.current) {
      ;(returnTo.current as HTMLElement).focus?.()
      returnTo.current = null
    }
  }, [running])
  useEffect(() => {
    if (running && key) bubbleRef.current?.focus({ preventScroll: true })
  }, [running, key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Listens for the walkthrough's keys while one is running: Esc skips, Right and Left step (not
    while typing in a field), and Tab stays in the bubble on a step that only tells. */
export function useWalkthroughKeys(running: unknown, bubbleRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      // The quiet wait (hands.ts): every key is the app's. Without this, Esc closing a menu skipped
      // a walkthrough the person could not see; the wait still ends by leaving the screen or its limit.
      if (useWalkthroughs.getState().quiet) return
      const at = e.target
      const bubbleEl = bubbleRef.current
      // Arrows step only from the bubble (or with nothing in focus): anywhere else they belong to
      // the control in focus (a field, a select, a tab row the step asked the person to use).
      const mine = !(at instanceof Element) || at === document.body || !!bubbleEl?.contains(at)
      const { dim, bubble } = useWalkthroughs.getState()
      // A hands-on step that has let its spotlight go (hands.ts): the page is the person's, so Esc
      // in one of its controls closes the list they opened. Without this it skipped the walkthrough.
      if (e.key === 'Escape' && !mine && !dim && bubble?.step?.hands) return
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
        // "Your turn": Tab from the bubble's last button goes to the highlighted control, which the
        // keyboard could not otherwise reach from here (the bubble sits at the end of the page).
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
  }, [running, bubbleRef])
}
