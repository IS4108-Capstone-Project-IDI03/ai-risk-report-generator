import type * as React from 'react'
import { Icon } from '../core/Icon'
export type ConfidenceIndicatorProps = {
  level?: string
  showLabel?: boolean
  style?: React.CSSProperties
}
const LEVELS: Record<string, { bars: number; label: string }> = {
  high: {
    bars: 3,
    label: 'High confidence',
  },
  medium: {
    bars: 2,
    label: 'Medium confidence',
  },
  low: {
    bars: 1,
    label: 'Low confidence',
  },
}
function ConfidenceIndicator({
  level = 'medium',
  showLabel = true,
  style = {},
}: ConfidenceIndicatorProps) {
  const l = LEVELS[level] || LEVELS.medium
  const color = level === 'low' ? 'var(--status-moderate-fg)' : 'var(--ai-fg)'
  return (
    <span
      title={l.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-caption-size)',
        color: 'var(--text-muted)',
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: 2,
          height: 12,
        }}
      >
        {[6, 9, 12].map((h, i) => (
          <span
            key={h}
            style={{
              width: 3,
              height: h,
              borderRadius: 1,
              background: i < l.bars ? color : 'var(--graphite-200)',
            }}
          />
        ))}
      </span>
      {showLabel ? <span>{l.label}</span> : null}
      {level === 'low' ? (
        <Icon name={'triangle-alert'} size={12} color={'var(--status-moderate-fg)'} />
      ) : null}
    </span>
  )
}
export { ConfidenceIndicator }
