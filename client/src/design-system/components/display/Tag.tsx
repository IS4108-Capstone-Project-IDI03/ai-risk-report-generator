import type * as React from 'react'
import { Icon } from '../core/Icon'
export type TagProps = {
  children?: React.ReactNode
  onRemove?: () => void
  // The remove button's accessible name, e.g. "Remove Severity: High".
  removeLabel?: string
  icon?: string
  style?: React.CSSProperties
}
function Tag({ children, onRemove, removeLabel = 'Remove', icon, style = {}, ...rest }: TagProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        height: 'var(--chip-height-md)',
        flex: '0 0 auto',
        padding: '0 10px',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-card)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-small-size)',
        ...style,
      }}
      {...rest}
    >
      {icon ? <Icon name={icon} size={12} color={'var(--text-muted)'} /> : null}
      {children}
      {/* A real button, so the keyboard reaches it. */}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            margin: '0 -4px 0 0',
            padding: 0,
            border: 0,
            borderRadius: 'var(--radius-xs)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <Icon name={'x'} size={12} />
        </button>
      ) : null}
    </span>
  )
}
export { Tag }
