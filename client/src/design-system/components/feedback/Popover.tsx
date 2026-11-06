import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Sheet, useIsPhone } from './Sheet'
import { useOverlayStack } from './overlayStack'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

export type PopoverProps = {
  // Controlled: the host owns the open state and toggles it from the trigger.
  open: boolean
  onOpenChange: (open: boolean) => void
  // The control that opens the popover, e.g. a bell button. It is cloned to
  // carry the aria state; no ref is attached to it (see below).
  trigger: ReactElement
  children?: ReactNode
  ariaLabel?: string
  align?: 'left' | 'right'
  className?: string
  surfaceClassName?: string
  style?: CSSProperties
  // Under 768 px the surface becomes a bottom sheet; set true to keep it floating.
  noSheet?: boolean
  // The phone sheet is a centred card instead of a bottom sheet (date picker).
  sheetCentred?: boolean
  // The phone sheet ends in a Cancel button in place of the close tick (RV-11 picker).
  sheetCancel?: boolean
  // A class on the phone sheet's root, for a feature's own look (it is portalled to the body).
  sheetClassName?: string
}

// A small floating surface anchored to a trigger. It owns the overlay
// behaviour — Escape, outside click, focus return — and nothing about
// notifications; that stays in the feature.
//
// jsdom cannot verify placement or focus trapping (see docs/areas/ui.md), so
// position is best-effort CSS and the browser pass covers the visual side.
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  ariaLabel,
  align = 'right',
  className = '',
  surfaceClassName = '',
  style,
  noSheet = false,
  sheetCentred = false,
  sheetCancel = false,
  sheetClassName,
}: PopoverProps) {
  const asSheet = useIsPhone() && !noSheet
  const anchor = useRef<HTMLDivElement>(null)
  // The trigger sits in a wrapper this component owns, so focus return reads
  // the node from that wrapper rather than attaching a ref to the cloned
  // trigger. Passing any ref through cloneElement trips the React Compiler
  // ("a ref may be read during render"); owning the wrapper side-steps it
  // entirely and leaves the trigger's own ref, if any, untouched.
  const triggerWrap = useRef<HTMLSpanElement>(null)
  const surfaceId = useId()

  // Closing plays a 120 ms fade before the surface unmounts (v2 section 8). Where
  // the browser can't animate (jsdom), it unmounts at once.
  const [leaving, setLeaving] = useState(false)
  const canAnimate = typeof Element !== 'undefined' && 'animate' in Element.prototype
  const present = open || leaving
  const wasShown = useRef(false)
  useEffect(() => {
    if (open) {
      wasShown.current = true
      return
    }
    if (!wasShown.current || !canAnimate) return
    wasShown.current = false
    setLeaving(true)
    const timer = setTimeout(() => setLeaving(false), 120)
    return () => clearTimeout(timer)
  }, [open, canAnimate])

  // Kept on screen: where its side of the trigger leaves too little room, as
  // when a phone's header wraps its actions to the left, it moves sideways
  // just enough to fit, a small margin from the edge. jsdom lays nothing out,
  // so a surface with no width is left where it is.
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = surface.current
    if (!open || !el) return
    const place = () => {
      el.style.transform = ''
      el.removeAttribute('data-flip')
      el.removeAttribute('data-cap')
      // offsetWidth ignores the scale-in animation, so the measure is the final size.
      const width = el.offsetWidth
      if (!width) return
      const margin = 8
      const room = document.documentElement.clientWidth - margin
      // Unscaled left edge: the anchor's left plus the surface's offset inside it.
      const left = (el.offsetParent?.getBoundingClientRect().left ?? 0) + el.offsetLeft
      const right = left + width
      const shift = left < margin ? margin - left : right > room ? room - right : 0
      if (shift) el.style.transform = `translateX(${shift}px)`
      // Vertical: stay above a sticky bottom bar and the window edge. Flip above the trigger
      // when there is more room there, else cap the height and scroll.
      const bar = document.querySelector('.ds-action-bar')?.getBoundingClientRect().top
      const limit = Math.min(window.innerHeight, bar ?? Infinity) - margin
      const box = el.getBoundingClientRect()
      const trigger = anchor.current?.getBoundingClientRect()
      if (!trigger || box.bottom <= limit) return
      if (trigger.top - margin * 2 >= box.height) el.setAttribute('data-flip', '')
      else {
        el.style.setProperty('--cap', `${Math.max(160, limit - box.top)}px`)
        el.setAttribute('data-cap', '')
      }
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, asSheet])

  // Opening moves focus to the selected item (or the first) of a menu inside, so a keyboard
  // user lands in it. Only options and menu items: a form inside keeps its own focus.
  useEffect(() => {
    if (!open || asSheet) return
    const el = surface.current
    const target =
      el?.querySelector<HTMLElement>('[role=option][aria-selected=true]') ??
      el?.querySelector<HTMLElement>('[role=option], [role=menuitem]')
    target?.focus()
  }, [open, asSheet])

  // Only the topmost overlay answers Esc, so one press closes one thing.
  const isTop = useOverlayStack(open && !asSheet)
  const closeRef = useRef(onOpenChange)
  useEffect(() => {
    closeRef.current = onOpenChange
  })
  useEffect(() => {
    if (!open || asSheet) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTop()) closeRef.current(false)
    }
    // mousedown, not click, so a press that starts outside closes before any
    // click handler inside a sibling runs.
    const onPointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) closeRef.current(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, asSheet, isTop])

  // Return focus to the trigger once the surface is gone, so a keyboard user
  // who closed with Escape lands back on the control they opened from. The
  // focusable control is the first element inside the wrapper (the trigger
  // itself if it is a button, else its first focusable child). Skipped on
  // first mount, when nothing was open to return from.
  const wasOpen = useRef(false)
  useEffect(() => {
    const wrap = triggerWrap.current
    // Focus already in the trigger (typing in the date text) stays where it is.
    if (!open && wasOpen.current && !wrap?.contains(document.activeElement)) {
      const focusable = wrap?.matches('button, [tabindex], a[href]')
        ? wrap
        : wrap?.querySelector<HTMLElement>('button, [tabindex], a[href]')
      focusable?.focus()
    }
    wasOpen.current = open
  }, [open])

  // The aria state belongs on the interactive control, so clone the trigger to
  // add it. Only plain props are injected — no ref — which keeps the clone
  // compiler-safe.
  const control = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        // A trigger that opens a menu or listbox says so itself; otherwise it's a dialog.
        'aria-haspopup': (trigger.props as Record<string, unknown>)['aria-haspopup'] ?? 'dialog',
        'aria-expanded': open,
        'aria-controls': open && !asSheet ? surfaceId : undefined,
      })
    : trigger

  return (
    <div
      ref={anchor}
      className={className}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
    >
      <span ref={triggerWrap} style={{ display: 'inline-flex' }}>
        {control}
      </span>
      {asSheet ? (
        <Sheet
          open={open}
          onClose={() => onOpenChange(false)}
          title={ariaLabel ?? ''}
          centred={sheetCentred}
          cancel={sheetCancel}
          className={sheetClassName}
        >
          {children}
        </Sheet>
      ) : (
        present && (
          <div
            ref={surface}
            data-state={open ? 'open' : 'closed'}
            id={surfaceId}
            role="dialog"
            aria-label={ariaLabel}
            className={`ds-popover ${surfaceClassName}`}
            style={{
              position: 'absolute',
              top: 'calc(100% + var(--space-2))',
              [align]: 0,
              zIndex: 50,
              minWidth: '320px',
              maxWidth: 'min(92vw, 420px)',
              background: 'var(--surface-card)',
              // Radius 14, shadow and 1px ring: v2 section 5. Scales in from the trigger's side (styles.css).
              borderRadius: 'var(--radius-popover)',
              boxShadow: 'var(--shadow-popover)',
              transformOrigin: align === 'left' ? 'top left' : 'top right',
              overflow: 'hidden',
            }}
          >
            {children}
          </div>
        )
      )}
    </div>
  )
}
