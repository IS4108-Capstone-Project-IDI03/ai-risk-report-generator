import type * as React from 'react'

export type MetricStatProps = {
  label?: React.ReactNode
  value?: string | number
  note?: string
  size?: 'sm' | 'md' | 'lg'
  align?: React.CSSProperties['textAlign']
  style?: React.CSSProperties
}
function MetricStat({
  label,
  value,
  note,
  size = 'md',
  align = 'left',
  style = {},
}: MetricStatProps) {
  const lg = size === 'lg'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        textAlign: align,
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-caption-size)',
          lineHeight: 'var(--text-caption-lh)',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-4)',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            fontSize: lg ? 'var(--text-metric-lg-size)' : 'var(--text-metric-md-size)',
            lineHeight: lg ? 'var(--text-metric-lg-lh)' : 'var(--text-metric-md-lh)',
            fontWeight: 'var(--text-metric-weight)',
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}
        >
          {value}
        </span>
        {note ? (
          <span
            style={{
              fontSize: 'var(--text-caption-size)',
            }}
          >
            {note}
          </span>
        ) : null}
      </span>
    </div>
  )
}
export { MetricStat }
