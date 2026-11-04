// Chips (CP-23, v2 section 6): jurisdiction, facility, division, plain code, and the New badge.
// Called by every screen that shows a site or client. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type ChipProps = {
  // jurisdiction = blue globe, facility = teal building, division = violet, code = plain grey.
  kind: 'jurisdiction' | 'facility' | 'division' | 'code'
  children: React.ReactNode
}

const KINDS = {
  jurisdiction: { icon: 'globe', fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  facility: { icon: 'building-2', fg: 'var(--teal-600)', bg: 'var(--teal-50)' },
  division: { icon: undefined, fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
  code: { icon: undefined, fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
}

/** Returns a 24 px category chip, no border. */
export function Chip({ kind, children }: ChipProps) {
  // No chip for an empty value: an empty pill is filler.
  if (children === null || children === undefined || children === false || children === '')
    return null
  const k = KINDS[kind]
  return (
    <span
      className="ds-chip"
      style={{ color: k.fg, background: k.bg }}
      title={typeof children === 'string' ? children : undefined}
    >
      {k.icon ? <Icon name={k.icon} size={12} /> : null}
      <span className="ds-chip-text" dir="auto">
        {children}
      </span>
    </span>
  )
}

/** Returns the green "New" badge (default text New). */
export function NewBadge({ children = 'New' }: { children?: React.ReactNode }) {
  return <span className="ds-new-badge">{children}</span>
}
