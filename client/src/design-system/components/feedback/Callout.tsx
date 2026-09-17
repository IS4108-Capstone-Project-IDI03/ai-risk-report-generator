import type * as React from 'react'
import { Icon } from '../core/Icon'
export type CalloutProps = {
  tone?: string
  title?: React.ReactNode
  icon?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  style?: React.CSSProperties
}
const TONES: Record<string, { fg: string; bg: string; bd?: string; icon?: string }> = {
  info: {
    fg: 'var(--ink-600)',
    bg: 'var(--ink-50)',
    bd: 'var(--ink-100)',
    icon: 'info',
  },
  warning: {
    fg: 'var(--status-moderate-fg)',
    bg: 'var(--status-moderate-bg)',
    bd: '#eddfc2',
    icon: 'triangle-alert',
  },
  danger: {
    fg: 'var(--action-danger)',
    bg: 'var(--red-50)',
    bd: '#f0d4d4',
    icon: 'octagon-alert',
  },
  success: {
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
    bd: '#cfe2d6',
    icon: 'check',
  },
  ai: {
    fg: 'var(--ai-fg)',
    bg: 'var(--ai-bg)',
    bd: 'var(--ai-border)',
    icon: 'sparkles',
  },
}
function Callout({ tone = 'info', title, icon, actions, children, style = {} }: CalloutProps) {
  const t = TONES[tone] || TONES.info
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-5)',
        padding: 'var(--space-5) var(--space-6)',
        background: t.bg,
        border: '1px solid ' + t.bd,
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        lineHeight: 'var(--text-body-lh)',
        color: 'var(--text-body)',
        ...style,
      }}
    >
      <Icon
        name={icon || t.icon}
        size={16}
        color={t.fg}
        style={{
          marginTop: 3,
        }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        {title ? (
          <div
            style={{
              fontWeight: 'var(--weight-semibold)',
              color: t.fg,
              marginBottom: 2,
            }}
          >
            {title}
          </div>
        ) : null}
        <div>{children}</div>
        {actions ? (
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              marginTop: 'var(--space-5)',
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
export { Callout }
