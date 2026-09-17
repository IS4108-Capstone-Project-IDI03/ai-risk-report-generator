import type * as React from 'react'

export type PageHeaderProps = {
  eyebrow?: React.ReactNode
  title?: React.ReactNode
  meta?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  style?: React.CSSProperties
}
function PageHeader({ eyebrow, title, meta, status, actions, style = {} }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-8)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        {eyebrow ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              fontSize: 'var(--text-eyebrow-size)',
              lineHeight: 'var(--text-eyebrow-lh)',
              letterSpacing: 'var(--text-eyebrow-ls)',
              textTransform: 'uppercase',
              fontWeight: 'var(--text-eyebrow-weight)',
              color: 'var(--text-muted)',
            }}
          >
            {eyebrow}
            {status ? (
              <span
                style={{
                  display: 'inline-flex',
                }}
              >
                {status}
              </span>
            ) : null}
          </div>
        ) : null}
        <h1
          style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--text-page-title-size)',
            lineHeight: 'var(--text-page-title-lh)',
            fontWeight: 'var(--text-page-title-weight)',
            letterSpacing: 'var(--text-page-title-ls)',
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h1>
        {meta ? (
          <div
            style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-meta-size)',
              lineHeight: 'var(--text-meta-lh)',
              color: 'var(--text-secondary)',
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            flex: '0 0 auto',
            paddingTop: 'var(--space-5)',
          }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  )
}
export { PageHeader }
