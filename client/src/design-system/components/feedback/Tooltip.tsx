import type * as React from 'react'

export type TooltipProps = {
  label?: React.ReactNode
  placement?: string
  children?: React.ReactNode
  style?: React.CSSProperties
}
import { useState } from 'react'
function Tooltip({ label, placement = 'top', children, style = {} }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const pos =
    placement === 'bottom'
      ? {
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
        }
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
            whiteSpace: 'nowrap',
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
