import type * as React from 'react'
import { Icon } from '../core/Icon'
export type TagProps = {
  children?: React.ReactNode
  onRemove?: () => void
  icon?: string
  style?: React.CSSProperties
}
function Tag({ children, onRemove, icon, style = {}, ...rest }: TagProps) {
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
      {onRemove ? (
        <span
          onClick={onRemove}
          style={{
            display: 'inline-flex',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <Icon name={'x'} size={12} />
        </span>
      ) : null}
    </span>
  )
}
export { Tag }
