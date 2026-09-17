import type * as React from 'react'
import { IconRegistry } from '../core/IconRegistry'
import { Icon } from '../core/Icon'
export type StatusIconProps = {
  status?: string
  showLabel?: boolean
  size?: number
  style?: React.CSSProperties
}
const BY_LABEL = Object.entries(IconRegistry.status).reduce(
  (m, [k, e]) => {
    m[k.toLowerCase()] = e
    if (e.label) m[e.label.toLowerCase()] = e
    return m
  },
  {} as Record<string, { icon: string; color: string; label: string }>,
)
function StatusIcon({ status, showLabel = true, size = 14, style = {} }: StatusIconProps) {
  const e = BY_LABEL[String(status).toLowerCase()] || {
    icon: 'circle',
    color: 'var(--text-muted)',
    label: status,
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <Icon
        name={e.icon}
        size={size}
        color={e.color}
        title={showLabel ? undefined : e.label || status}
      />
      {showLabel ? e.label || status : null}
    </span>
  )
}
export { StatusIcon }
