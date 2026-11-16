import type * as React from 'react'

export type TooltipProps = {
  label?: React.ReactNode
  placement?: string
  children?: React.ReactNode
  style?: React.CSSProperties
  // For a sentence rather than a short name: the bubble wraps at this width instead of running
  // on one line past the edge of its container (AS-06 round 9, the card help line).
  maxWidth?: number | string
  // Also opens on a click or tap (a phone has no hover, and iOS does not focus a tapped button);
  // a press anywhere outside, or Escape, closes it. Off by default: other tooltips are unchanged.
  tap?: boolean
}
import { useEffect, useRef, useState } from 'react'
function Tooltip({
  label,
  placement = 'top',
  children,
  style = {},
  maxWidth,
  tap = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  // A press outside the wrapper closes a tap tooltip (a tap elsewhere on a phone), as ReasonWrap does.
  useEffect(() => {
    if (!tap || !open) return
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [tap, open])
  const pos =
    placement === 'bottom'
      ? {
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
        }
      : placement === 'bottom-start'
        ? // Under the anchor, starting at its left edge (a sentence under a card's title).
          { top: 'calc(100% + 6px)', left: 0 }
        : placement === 'bottom-end'
          ? // Under the trigger, ending at its right edge, for a trigger at a scrolling box's right edge.
            { top: 'calc(100% + 6px)', right: 0 }
          : placement === 'top-end'
            ? // Right edge of the trigger, for triggers at a card's right edge (CP-23).
              { bottom: 'calc(100% + 6px)', right: 0 }
            : placement === 'right'
              ? {
                  left: 'calc(100% + 6px)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }
              : {
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }
  return (
    <span
      ref={wrap}
      // Opens, never toggles: a phone's tap fires its emulated hover first, and a toggle would close it.
      onClick={tap ? () => setOpen(true) : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
      style={{
        position: 'relative',
        display: 'inline-flex',
        ...style,
      }}
    >
      {children}
      {open ? (
        <span
          role={'tooltip'}
          style={{
            position: 'absolute',
            ...pos,
            padding: '4px 8px',
            background: 'var(--surface-inverse)',
            color: 'var(--graphite-0)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-caption-size)',
            lineHeight: 'var(--text-caption-lh)',
            ...(maxWidth
              ? { whiteSpace: 'normal', width: 'max-content', maxWidth }
              : { whiteSpace: 'nowrap' }),
            boxShadow: 'var(--shadow-md)',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
export { Tooltip }
