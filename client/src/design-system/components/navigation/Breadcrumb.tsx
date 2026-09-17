import * as React from 'react'
import { Icon } from '../core/Icon'
export type BreadcrumbProps = {
  items?: { label: string; onClick?: () => void }[]
  style?: React.CSSProperties
}
function Breadcrumb({ items = [], style = {} }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-small-size)',
        ...style,
      }}
    >
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <React.Fragment key={it.label}>
            <span
              aria-current={last ? 'page' : undefined}
              style={{
                color: last ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: last ? 'var(--weight-medium)' : 'var(--weight-regular)',
                cursor: 'default',
              }}
            >
              {!last && it.onClick ? (
                <button type="button" className="text-link" onClick={it.onClick}>
                  {it.label}
                </button>
              ) : (
                it.label
              )}
            </span>
            {last ? null : <Icon name={'chevron-right'} size={12} color={'var(--graphite-400)'} />}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
export { Breadcrumb }
