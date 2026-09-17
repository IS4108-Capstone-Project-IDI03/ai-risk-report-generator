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
  warning: 'triangle-alert',
  danger: 'octagon-alert',
}
const FG: Record<string, string> = {
  success: 'var(--green-600)',
  info: 'var(--ink-300)',
  warning: 'var(--status-moderate-fg)',
  danger: 'var(--red-600)',
}
function Toast({ tone = 'info', message, action, onDismiss, style = {} }: ToastProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        padding: 'var(--space-5) var(--space-5) var(--space-5) var(--space-6)',
        background: 'var(--surface-inverse)',
        color: 'var(--graphite-0)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        maxWidth: 460,
        ...style,
      }}
    >
      <Icon name={ICONS[tone] || 'info'} size={16} color={FG[tone]} />
      <span
        style={{
          flex: 1,
        }}
      >
        {message}
      </span>
      {action ? (
        <span
          style={{
            color: 'var(--ink-200)',
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
          onClick={onDismiss}
          style={{
            color: 'var(--graphite-400)',
          }}
        />
      ) : null}
    </div>
  )
}
export { Toast }
