// Badge (v2): a pill in one tone, icon + word, drawn exactly like the status pill (`.ds-pill`:
// 26 px, 13 / 600, radius 999), so every pill in the app is one look. StatusPill is the same
// pill keyed by a status; Badge is for a tone chosen by the screen ("Resolved", "Usual choice").
// The knowledge base's TonePill was merged into it. Called by feature screens. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'
export type BadgeProps = {
  tone?: string
  icon?: string
  dot?: boolean
  children?: React.ReactNode
  style?: React.CSSProperties
  // A screen's own class for layout only (MarshBot's status wraps to two lines in its rail).
  className?: string
  // Hover text: the whole label where a long one ends in "…".
  title?: string
}
// Severity tones (critical … low), meaning tones (danger, info, ai) and plain colours (green …
// violet) for a pill that is neither. Tokens only (v2 section 3).
const TONES: Record<string, { fg: string; bg: string }> = {
  critical: { fg: 'var(--status-critical-fg)', bg: 'var(--status-critical-bg)' },
  high: { fg: 'var(--status-high-fg)', bg: 'var(--status-high-bg)' },
  moderate: { fg: 'var(--status-moderate-fg)', bg: 'var(--status-moderate-bg)' },
  low: { fg: 'var(--status-low-fg)', bg: 'var(--status-low-bg)' },
  // A status that is out of use, e.g. a withdrawn knowledge document. Not a
  // severity, so it doesn't borrow `critical`.
  danger: { fg: 'var(--action-danger)', bg: 'var(--red-50)' },
  neutral: { fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
  info: { fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  ai: { fg: 'var(--ai-fg)', bg: 'var(--ai-bg)' },
  green: { fg: 'var(--green-600)', bg: 'var(--green-50)' },
  amber: { fg: 'var(--amber-600)', bg: 'var(--amber-50)' },
  red: { fg: 'var(--red-600)', bg: 'var(--red-50)' },
  blue: { fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  grey: { fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
  violet: { fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
}
/** Returns the pill: an optional dot or icon, then `children`, in the tone's colours. */
function Badge({
  tone = 'neutral',
  icon,
  dot = false,
  children,
  style = {},
  className,
  ...rest
}: BadgeProps) {
  const t = TONES[tone] || TONES.neutral
  return (
    <span
      className={className ? `ds-pill ${className}` : 'ds-pill'}
      // The longhand: jsdom fails to clone a `background` shorthand (as in StatusPill).
      style={{ color: t.fg, backgroundColor: t.bg, flex: '0 0 auto', ...style }}
      {...rest}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: t.fg,
          }}
        />
      ) : null}
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  )
}
export { Badge }
