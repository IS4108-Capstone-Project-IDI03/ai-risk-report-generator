import type * as React from 'react'

export type CardProps = {
  title?: React.ReactNode
  subtitle?: string
  actions?: React.ReactNode
  footer?: React.ReactNode
  padding?: string
  tone?: string
  headerTone?: string
  children?: React.ReactNode
  style?: React.CSSProperties
}
function Card({
  title,
  subtitle,
  actions,
  footer,
  padding = 'var(--space-7)',
  tone = 'default',
  headerTone = 'default',
  children,
  style = {},
  ...rest
}: CardProps) {
  const border = tone === 'ai' ? '1px solid var(--ai-border)' : '1px solid var(--border-default)'
  const bg =
    tone === 'ai'
      ? 'var(--ai-bg)'
      : tone === 'sunken'
        ? 'var(--surface-sunken)'
        : 'var(--surface-card)'
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: bg,
        border: border,
        borderRadius: 'var(--radius-lg)',
        boxShadow: tone === 'sunken' ? 'none' : 'var(--shadow-sm)',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-body)',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {title || actions ? (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-6)',
            padding: 'var(--space-5) ' + 'var(--space-7)',
            background: headerTone === 'sunken' ? 'var(--surface-header)' : 'transparent',
            borderBottom:
              '1px solid ' +
              (headerTone === 'sunken' ? 'var(--border-default)' : 'var(--border-subtle)'),
          }}
        >
          <div
            style={{
              minWidth: 0,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 'var(--text-h3-size)',
                lineHeight: 'var(--text-h3-lh)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--text-primary)',
              }}
            >
              {title}
            </h3>
            {subtitle ? (
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 'var(--text-caption-size)',
                  color: 'var(--text-muted)',
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                flex: '0 0 auto',
              }}
            >
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      <div
        style={{
          padding: padding,
          flex: 1,
          minHeight: 0,
        }}
      >
        {children}
      </div>
      {footer ? (
        <footer
          style={{
            padding: 'var(--space-5) var(--space-7)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-sunken)',
          }}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  )
}
export { Card }
