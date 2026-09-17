import type * as React from 'react'
import { Icon } from '../core/Icon'
export type BadgeProps = {
  tone?: string
  icon?: string
  dot?: boolean
  children?: React.ReactNode
  style?: React.CSSProperties
}
const TONES: Record<string, { fg: string; bg: string; bd?: string; icon?: string }> = {
  critical: {
    fg: 'var(--status-critical-fg)',
    bg: 'var(--status-critical-bg)',
  },
  high: {
    fg: 'var(--status-high-fg)',
    bg: 'var(--status-high-bg)',
  },
  moderate: {
    fg: 'var(--status-moderate-fg)',
    bg: 'var(--status-moderate-bg)',
  },
  low: {
    fg: 'var(--status-low-fg)',
    bg: 'var(--status-low-bg)',
  },
  neutral: {
    fg: 'var(--status-neutral-fg)',
    bg: 'var(--status-neutral-bg)',
  },
  info: {
    fg: 'var(--ink-600)',
    bg: 'var(--ink-50)',
  },
  ai: {
    fg: 'var(--ai-fg)',
    bg: 'var(--ai-bg)',
  },
}
function Badge({ tone = 'neutral', icon, dot = false, children, style = {}, ...rest }: BadgeProps) {
  const t = TONES[tone] || TONES.neutral
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        height: 'var(--chip-height-sm)',
        flex: '0 0 auto',
        padding: '0 9px',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-sm)',
        background: t.bg,
        color: t.fg,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-caption-size)',
        fontWeight: 'var(--weight-medium)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
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
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  )
}
export { Badge }
