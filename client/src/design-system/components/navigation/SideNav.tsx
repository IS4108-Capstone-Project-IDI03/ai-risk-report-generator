import type * as React from 'react'
import { Icon } from '../core/Icon'
export type SideNavProps = {
  logoSrc?: string
  product?: React.ReactNode
  brand?: string
  sections?: {
    label: string
    items: { value: string; label: string; icon?: string; count?: number }[]
  }[]
  value?: string | number
  onChange?: (value: string) => void
  footer?: React.ReactNode
  style?: React.CSSProperties
}
function SideNav({
  logoSrc,
  product = 'Risk Report Generator',
  brand = 'Marsh',
  sections = [],
  value,
  onChange,
  footer,
  style = {},
}: SideNavProps) {
  return (
    <nav
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 'var(--sidebar-width)',
        flex: '0 0 auto',
        height: '100%',
        background: 'var(--surface-nav)',
        color: 'var(--graphite-300)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          padding: 'var(--space-9) var(--space-7)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={'Marsh'}
            style={{
              height: 17,
              width: 'auto',
              display: 'block',
            }}
          />
        ) : (
          <span
            style={{
              color: 'var(--graphite-0)',
              fontSize: 'var(--text-h3-size)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: '-0.01em',
            }}
          >
            {brand}
          </span>
        )}
        {product ? (
          <span
            style={{
              fontSize: 'var(--text-small-size)',
              color: 'var(--graphite-400)',
              letterSpacing: '0.01em',
            }}
          >
            {product}
          </span>
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-7) var(--space-5)',
        }}
      >
        {sections.map((sec) => (
          <div
            key={sec.label || 'default'}
            style={{
              marginBottom: 'var(--space-7)',
            }}
          >
            {sec.label ? (
              <div
                style={{
                  padding: '0 var(--space-4) var(--space-4)',
                  fontSize: 'var(--text-label-size)',
                  letterSpacing: 'var(--text-label-ls)',
                  textTransform: 'uppercase',
                  fontWeight: 'var(--text-label-weight)',
                  color: 'var(--graphite-500)',
                }}
              >
                {sec.label}
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
              }}
            >
              {(sec.items || []).map((it) => {
                const active = it.value === value
                return (
                  <button
                    key={it.value}
                    aria-current={active ? 'page' : undefined}
                    type={'button'}
                    onClick={() => onChange && onChange(it.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-5)',
                      height: 45,
                      padding: '0 var(--space-4)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                      color: active ? 'var(--graphite-0)' : 'var(--graphite-300)',
                      fontFamily: 'inherit',
                      fontSize: 'var(--text-body-size)',
                      fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-regular)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'var(--transition-control)',
                    }}
                  >
                    <Icon name={it.icon || 'circle'} size={15} />
                    <span
                      style={{
                        flex: 1,
                      }}
                    >
                      {it.label}
                    </span>
                    {it.count != null ? (
                      <span
                        style={{
                          fontSize: 'var(--text-caption-size)',
                          color: 'var(--graphite-400)',
                        }}
                      >
                        {it.count}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {footer ? (
        <div
          style={{
            padding: 'var(--space-7) var(--space-6)',
            borderTop: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {footer}
        </div>
      ) : null}
    </nav>
  )
}
export { SideNav }
