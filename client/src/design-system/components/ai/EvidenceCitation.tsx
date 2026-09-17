import type * as React from 'react'
import { Icon } from '../core/Icon'
export type EvidenceCitationProps = {
  kind?: string
  source?: React.ReactNode
  locator?: string
  excerpt?: React.ReactNode
  index?: number
  onOpen?: () => void
  style?: React.CSSProperties
}
import { useState } from 'react'
const KIND: Record<string, { icon: string; label: string; fg: string; bg: string }> = {
  standard: {
    icon: 'book-marked',
    label: 'External standard',
    fg: 'var(--ink-600)',
    bg: 'var(--ink-50)',
  },
  report: {
    icon: 'file-text',
    label: 'Past report',
    fg: 'var(--graphite-700)',
    bg: 'var(--graphite-100)',
  },
  observation: {
    icon: 'camera',
    label: 'Site observation',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  photo: {
    icon: 'image',
    label: 'Photograph',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  note: {
    icon: 'sticky-note',
    label: 'Engineer note',
    fg: 'var(--status-moderate-fg)',
    bg: 'var(--status-moderate-bg)',
  },
  insight: {
    icon: 'sparkles',
    label: 'AI insight',
    fg: 'var(--ai-fg)',
    bg: 'var(--ai-bg)',
  },
}
function EvidenceCitation({
  kind = 'report',
  source,
  locator,
  excerpt,
  index,
  onOpen,
  style = {},
}: EvidenceCitationProps) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        gap: 'var(--space-5)',
        padding: 'var(--space-5) var(--space-6)',
        background: hover ? 'var(--surface-hover)' : 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        cursor: onOpen ? 'pointer' : 'default',
        fontFamily: 'var(--font-sans)',
        transition: 'var(--transition-control)',
        ...style,
      }}
    >
      {index != null ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            flex: '0 0 auto',
            marginTop: 1,
            borderRadius: 'var(--radius-xs)',
            background: 'var(--ai-bg)',
            color: 'var(--ai-fg)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 'var(--weight-medium)',
          }}
        >
          {index}
        </span>
      ) : (
        <Icon
          name={(KIND[kind] || KIND.report).icon}
          size={15}
          color={(KIND[kind] || KIND.report).fg}
          style={{
            marginTop: 2,
          }}
        />
      )}
      <div
        style={{
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-2)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 18,
              padding: '0 6px',
              borderRadius: 'var(--radius-xs)',
              background: (KIND[kind] || KIND.report).bg,
              color: (KIND[kind] || KIND.report).fg,
              fontSize: 'var(--text-label-size)',
              fontWeight: 'var(--weight-medium)',
              letterSpacing: '0.02em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name={(KIND[kind] || KIND.report).icon} size={11} />
            {(KIND[kind] || KIND.report).label}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-4)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-small-size)',
              fontWeight: 'var(--weight-medium)',
              color: 'var(--text-primary)',
            }}
          >
            {source}
          </span>
          {locator ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-mono-size)',
                color: 'var(--text-muted)',
              }}
            >
              {locator}
            </span>
          ) : null}
        </div>
        {excerpt ? (
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              fontSize: 'var(--text-caption-size)',
              lineHeight: 'var(--text-caption-lh)',
              color: 'var(--text-secondary)',
              borderLeft: '2px solid var(--border-default)',
              paddingLeft: 'var(--space-5)',
            }}
          >
            {excerpt}
          </p>
        ) : null}
      </div>
      {onOpen ? <Icon name={'arrow-up-right'} size={14} color={'var(--text-muted)'} /> : null}
    </div>
  )
}
export { EvidenceCitation }
