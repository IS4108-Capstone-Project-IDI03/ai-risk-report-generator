// Reason box (CP-23, boards 06/19): a small white box that explains why a control is blocked.
// Called by Button and IconButton (their `disabledReason`). Calls Icon.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../core/Icon'

export type Reason = { title: string; text: string }

/** Returns the visible box. It flips to the right edge, and above its control, when it would run off the screen or out of the dialog round it. */
export function ReasonBox({
  title,
  text,
  leaving = false,
}: Reason & { id?: string; leaving?: boolean }) {
  const box = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    // Set to position: fixed by a feature's CSS where a scrolling row round the control would cut
    // the box off (the phone editor's swipe toolbar): placed against the window from its control,
    // below it or above when the window has no room, and kept there as anything scrolls.
    if (getComputedStyle(el).position === 'fixed') {
      const place = () => {
        const control = el.parentElement?.getBoundingClientRect()
        if (!control) return
        const room = document.documentElement.clientWidth - 8 - el.offsetWidth
        el.style.left = `${Math.max(8, Math.min(control.left, room))}px`
        const below = control.bottom + 8
        const up = below + el.offsetHeight > window.innerHeight - 8
        el.style.top = `${up ? control.top - 8 - el.offsetHeight : below}px`
      }
      place()
      window.addEventListener('scroll', place, true)
      window.addEventListener('resize', place)
      return () => {
        window.removeEventListener('scroll', place, true)
        window.removeEventListener('resize', place)
      }
    }
    // A dialog scrolls and clips what sticks out of it (a Save button in its footer), so the box
    // must fit inside the dialog too, not just the window.
    const room = el.closest('dialog')?.getBoundingClientRect()
    // A dialog's content stops 24px inside its edge (its padding): a box that hangs past that
    // lines up with its control's right edge instead, as one in the window keeps 8px.
    const right = Math.min(
      room ? room.right - 24 : Infinity,
      document.documentElement.clientWidth - 8,
    )
    const bottom = Math.min(room?.bottom ?? Infinity, window.innerHeight) - 8
    const at = el.getBoundingClientRect()
    if (at.right > right) el.setAttribute('data-flip', '')
    // Inside a dialog only: a box on a page may run below the fold and scroll into view.
    if (room && at.bottom > bottom) el.setAttribute('data-up', '')
  }, [])
  // No id: the control describes itself from the always-present hidden span (ReasonWrap).
  return (
    <span ref={box} role="tooltip" className="ds-reason-box" data-leaving={leaving || undefined}>
      <span className="ds-reason-title">
        <Icon name="lock" size={14} color="var(--amber-600)" />
        {title}
      </span>
      {text}
    </span>
  )
}

/**
 * Wraps a blocked control: shows the reason on hover, keyboard focus or tap, and hands the
 * control the id to describe itself with. Without a reason it renders the control as is.
 */
export function ReasonWrap({
  reason,
  children,
}: {
  reason?: Reason
  children: (describedBy: string | undefined, onBlockedClick: () => void) => ReactNode
}) {
  const id = useId()
  // 'pending' is a hover's 150 ms wait so the box doesn't flicker as the pointer passes;
  // 'leaving' keeps it mounted for its 100 ms fade-out (board 17 · 9).
  const [state, setState] = useState<'off' | 'pending' | 'on' | 'leaving'>('off')
  useEffect(() => {
    if (state !== 'pending' && state !== 'leaving') return
    const t = setTimeout(
      () => setState(state === 'pending' ? 'on' : 'off'),
      state === 'pending' ? 150 : 100,
    )
    return () => clearTimeout(t)
  }, [state])
  const show = () => setState('on')
  const hide = () => setState((s) => (s === 'on' ? 'leaving' : 'off'))
  // A press outside the wrapper hides the box (a tap elsewhere on a phone).
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (state !== 'on') return
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) hide()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [state])
  if (!reason) return <>{children(undefined, () => {})}</>
  return (
    <span
      ref={wrap}
      className="ds-reason-wrap"
      onMouseEnter={() => setState((s) => (s === 'on' ? 'on' : 'pending'))}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {children(id, show)}
      {/* Always in the DOM so the control's aria-describedby has words before the box shows. */}
      <span id={id} className="ds-sr-only">
        {reason.title}. {reason.text}
      </span>
      {state === 'on' || state === 'leaving' ? (
        <ReasonBox leaving={state === 'leaving'} {...reason} />
      ) : null}
    </span>
  )
}
