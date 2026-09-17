import type * as React from 'react'
import { Icon } from '../core/Icon'
export type EmptyStateProps = {
  icon?: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  style?: React.CSSProperties
}
function EmptyState({
  icon = 'file-text',
  title,
  description,
  action,
  style = {},
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-11) var(--space-8)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <Icon name={icon} size={18} color={'var(--text-muted)'} />
      </span>
      <div
        style={{
          fontSize: 'var(--text-h3-size)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </div>
      {description ? (
        <div
          style={{
            fontSize: 'var(--text-body-size)',
            lineHeight: 'var(--text-body-lh)',
            color: 'var(--text-muted)',
            maxWidth: 380,
          }}
        >
          {description}
        </div>
      ) : null}
      {action ? (
        <div
          style={{
            marginTop: 'var(--space-4)',
          }}
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
export { EmptyState }
