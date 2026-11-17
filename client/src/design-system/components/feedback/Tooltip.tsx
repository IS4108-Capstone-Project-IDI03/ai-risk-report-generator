import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
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
// The strings inside a label: a label can be a node holding several lines (the rail's client card).
const wordsOf = (node: React.ReactNode): string[] =>
  typeof node === 'string' || typeof node === 'number'
    ? [String(node)]
    : Array.isArray(node)
      ? node.flatMap(wordsOf)
      : isValidElement<{ children?: React.ReactNode }>(node)
        ? wordsOf(node.props.children)
        : []

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
  const tipId = useId()
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
  // The bubble describes its trigger, unless its words are the trigger's own name (a screen
  // reader would then say them twice). The id exists while the bubble is open, which is when the
  // trigger has keyboard focus.
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null
  const trigger = isValidElement<Record<string, unknown>>(only) ? only : null
  const named =
    (trigger?.props['aria-label'] as string | undefined) ??
    // A design-system button's accessible name is its `label` prop (IconButton).
    (trigger?.props.label as string | undefined) ??
    (typeof trigger?.props.children === 'string' ? trigger.props.children : undefined)
  // Not when the trigger's own name already says it ("Observations, 3" and "Observations"): a
  // screen reader would read the words twice. And only while the bubble is open, since its id
  // exists only then: a closed tooltip must not point at an element that is not there.
  const words = wordsOf(label)
  const describes =
    open && !!trigger && !(!!named && words.length > 0 && words.every((w) => named.includes(w)))
  // Always the same clone, described or not: swapping between the child and a clone of it as the
  // bubble opens would remount the trigger and drop its focus.
  const content = trigger
    ? cloneElement(
        trigger,
        describes
          ? {
              'aria-describedby': [trigger.props['aria-describedby'] as string | undefined, tipId]
                .filter(Boolean)
                .join(' '),
            }
          : {},
      )
    : children
  return (
    <span
      ref={wrap}
      // Opens, never toggles: a phone's tap fires its emulated hover first, and a toggle would close it.
      onClick={tap ? () => setOpen(true) : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Keyboard focus only, as the browser itself judges it (:focus-visible): the focus a click
      // gives, and the focus a dialog hands back when it is closed with a click on Cancel, must
      // not open a bubble that then stays until blur.
      onFocus={(event) => {
        if (event.target.matches(':focus-visible')) setOpen(true)
      }}
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
      {content}
      {open ? (
        <span
          id={tipId}
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
