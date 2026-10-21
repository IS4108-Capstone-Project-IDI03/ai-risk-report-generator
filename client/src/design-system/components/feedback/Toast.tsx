import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
export type ToastProps = {
  tone?: string
  message?: React.ReactNode
  action?: React.ReactNode
  onDismiss?: () => void
  style?: React.CSSProperties
}
const ICONS: Record<string, string> = {
  success: 'check',
  info: 'info',
  warning: 'circle-alert',
  danger: 'circle-alert',
}
// Per tone: card tint, hairline border and the solid circle behind the white glyph.
// The tint makes the toast read as a status at a glance, not as another white card.
const TONES: Record<string, { bg: string; border: string; fill: string }> = {
  success: {
    bg: 'var(--status-low-bg)',
    border: 'color-mix(in srgb, var(--green-600) 40%, var(--status-low-bg))',
    fill: 'var(--green-600)',
  },
  info: {
    bg: 'var(--ink-50)',
    border: 'var(--ink-200)',
    fill: 'var(--ink-600)',
  },
  warning: {
    bg: 'var(--amber-50)',
    border: 'var(--amber-500)',
    fill: 'var(--amber-600)',
  },
  danger: {
    bg: 'var(--red-50)',
    border: 'color-mix(in srgb, var(--red-600) 45%, var(--red-50))',
    fill: 'var(--red-600)',
  },
}
// Good news fades by itself; warnings and errors wait to be read and closed.
const AUTO_CLOSE_MS = 5000
const EXIT_MS = 200 // the fade-out before the toast is removed
const AUTO_CLOSE_TONES = ['success', 'info']
function Toast({ tone = 'info', message, action, onDismiss, style = {} }: ToastProps) {
  // Hover or keyboard focus pauses the countdown; leaving restarts the full 5s.
  const [paused, setPaused] = useState(false)
  const autoClose = AUTO_CLOSE_TONES.includes(tone)
  // Held in a ref so a parent that re-renders (new onDismiss each time) does not restart the countdown.
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  // Closing (by timer or the X) first fades the card out, then tells the parent.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => dismiss.current?.(), EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving])
  useEffect(() => {
    if (!autoClose || paused) return
    const timer = setTimeout(() => setLeaving(true), AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [autoClose, paused, message])
  const t = TONES[tone] || TONES.info
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        position: 'relative',
        overflow: 'hidden', // clips the countdown bar to the card's (or the chat pill's) corners
        minWidth: 'min(320px, 100%)',
        padding: '8px var(--space-3) 8px var(--space-5)',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'none',
        transition: `opacity ${EXIT_MS}ms var(--ease-in), transform ${EXIT_MS}ms var(--ease-in)`,
        background: t.bg,
        color: 'var(--text-primary)',
        border: `1px solid ${t.border}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        fontWeight: 'var(--weight-medium)',
        maxWidth: 480,
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          flex: '0 0 auto',
          borderRadius: '50%',
          background: t.fill,
        }}
      >
        <Icon name={ICONS[tone] || 'info'} size={14} color="#fff" />
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      {action ? (
        <span
          style={{
            color: 'var(--ink-600)',
            fontWeight: 'var(--weight-medium)',
            cursor: 'pointer',
          }}
        >
          {action}
        </span>
      ) : null}
      {onDismiss ? (
        <IconButton
          icon={'x'}
          label={'Dismiss'}
          size={'sm'}
          onClick={() => setLeaving(true)}
          style={{ color: 'var(--text-muted)' }}
        />
      ) : null}
      {autoClose ? (
        // Shows the time left. Remounting on pause/resume restarts it, matching the timer
        // above (which restarts the full 5s). While paused it sits full, with no animation.
        <span
          key={`${paused}-${typeof message === 'string' ? message : ''}`}
          className="toast-bar"
          aria-hidden="true"
          style={{
            background: t.fill,
            animation: paused ? 'none' : `toast-countdown ${AUTO_CLOSE_MS}ms linear forwards`,
          }}
        />
      ) : null}
    </div>
  )
}
export { Toast }
