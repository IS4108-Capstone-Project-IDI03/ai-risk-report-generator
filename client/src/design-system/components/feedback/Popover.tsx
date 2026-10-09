import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react'
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
}: PopoverProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The trigger sits in a wrapper this component owns, so focus return reads
  // the node from that wrapper rather than attaching a ref to the cloned
  // trigger. Passing any ref through cloneElement trips the React Compiler
  // ("a ref may be read during render"); owning the wrapper side-steps it
  // entirely and leaves the trigger's own ref, if any, untouched.
  const triggerWrap = useRef<HTMLSpanElement>(null)
  const surfaceId = useId()

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    // mousedown, not click, so a press that starts outside closes before any
    // click handler inside a sibling runs.
    const onPointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, onOpenChange])

  // Return focus to the trigger once the surface is gone, so a keyboard user
  // who closed with Escape lands back on the control they opened from. The
  // focusable control is the first element inside the wrapper (the trigger
  // itself if it is a button, else its first focusable child). Skipped on
  // first mount, when nothing was open to return from.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open && wasOpen.current) {
      const wrap = triggerWrap.current
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
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? surfaceId : undefined,
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
      {open && (
        <div
          id={surfaceId}
          role="dialog"
          aria-label={ariaLabel}
          className={surfaceClassName}
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-2))',
            [align]: 0,
            zIndex: 50,
            minWidth: '320px',
            maxWidth: 'min(92vw, 420px)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
