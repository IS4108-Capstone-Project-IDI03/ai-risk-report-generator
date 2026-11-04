import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
import { SuccessIcon } from './SuccessIcon'
export type ToastProps = {
  tone?: string
  message?: React.ReactNode
  action?: React.ReactNode
  onDismiss?: () => void
  // How long good news stays up; an Undo needs longer than the default.
  autoCloseMs?: number
  style?: React.CSSProperties
}
const ICONS: Record<string, string> = {
  info: 'info',
  warning: 'circle-alert',
  danger: 'circle-alert',
}
// Per tone: card tint, hairline border and the solid circle behind the white glyph.
// The tint makes the toast read as a status at a glance, not as another white card.
// v2 section 7: every tone is the same white card; only the icon takes a colour.
const TONES: Record<string, { fill: string }> = {
  success: { fill: 'var(--green-600)' },
  info: { fill: 'var(--ink-600)' },
  warning: { fill: 'var(--amber-600)' },
  danger: { fill: 'var(--red-600)' },
}
// Good news fades by itself; warnings and errors wait to be read and closed.
const AUTO_CLOSE_MS = 5000
const EXIT_MS = 200 // the fade-out before the toast is removed
const AUTO_CLOSE_TONES = ['success', 'info']
function Toast({
  tone = 'info',
  message,
  action,
  onDismiss,
  autoCloseMs = AUTO_CLOSE_MS,
  style = {},
}: ToastProps) {
  // Hover or keyboard focus pauses the countdown; leaving restarts the full time.
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
    const timer = setTimeout(() => setLeaving(true), autoCloseMs)
    return () => clearTimeout(timer)
  }, [autoClose, paused, message, autoCloseMs])
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
        padding: '12px var(--space-3) 12px var(--space-6)',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'none',
        transition: `opacity ${EXIT_MS}ms var(--ease-in), transform ${EXIT_MS}ms var(--ease-in)`,
        background: 'var(--surface-card)',
        color: 'var(--graphite-900)',
        borderRadius: 'var(--radius-popover)',
        boxShadow: 'var(--shadow-popover)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        fontWeight: 'var(--weight-medium)',
        maxWidth: 480,
        ...style,
      }}
    >
      {tone === 'success' ? (
        <SuccessIcon />
      ) : (
        <Icon name={ICONS[tone] || 'info'} size={18} color={t.fill} />
      )}
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
            animation: paused ? 'none' : `toast-countdown ${autoCloseMs}ms linear forwards`,
          }}
        />
      ) : null}
    </div>
  )
}
export { Toast }
