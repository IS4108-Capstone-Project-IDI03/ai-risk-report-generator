import type * as React from 'react'

export type ProgressBarProps = {
  value?: number
  label?: React.ReactNode
  showValue?: boolean
  tone?: string
  style?: React.CSSProperties
}
function ProgressBar({
  value = 0,
  label,
  showValue = true,
  tone = 'primary',
  style = {},
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value))
  const fill =
    tone === 'ai'
      ? 'var(--ai-fg)'
      : tone === 'success'
        ? 'var(--green-600)'
        : 'var(--action-primary)'
  return (
    <div
      role="progressbar"
      aria-label={typeof label === 'string' ? label : 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      {label || showValue ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)',
            fontSize: 'var(--text-caption-size)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>{label}</span>
          {showValue ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              {pct + '%'}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          height: 4,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--graphite-100)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: pct + '%',
            height: '100%',
            background: fill,
            transition: 'width var(--duration-slow) var(--ease-standard)',
          }}
        />
      </div>
    </div>
  )
}
export { ProgressBar }
