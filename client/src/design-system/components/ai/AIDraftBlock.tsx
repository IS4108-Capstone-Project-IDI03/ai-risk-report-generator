import type * as React from 'react'
import { Badge } from '../display/Badge'
import { ConfidenceIndicator } from './ConfidenceIndicator'
import { Icon } from '../core/Icon'
import { Button } from '../core/Button'
export type AIDraftBlockProps = {
  heading?: React.ReactNode
  status?: string
  confidence?: string
  evidenceCount?: number
  children?: React.ReactNode
  onAccept?: () => void
  onEdit?: () => void
  onShowEvidence?: () => void
  style?: React.CSSProperties
}
import { useState } from 'react'
const STATUS: Record<string, { tone: string; label: string; icon: string }> = {
  draft: {
    tone: 'ai',
    label: 'AI draft',
    icon: 'sparkles',
  },
  edited: {
    tone: 'info',
    label: 'Edited by you',
    icon: 'pencil',
  },
  accepted: {
    tone: 'low',
    label: 'Accepted',
    icon: 'check',
  },
  flagged: {
    tone: 'moderate',
    label: 'Needs review',
    icon: 'triangle-alert',
  },
}
function AIDraftBlock({
  heading,
  status = 'draft',
  confidence = 'medium',
  evidenceCount = 0,
  children,
  onAccept,
  onEdit,
  onShowEvidence,
  style = {},
}: AIDraftBlockProps) {
  const [hover, setHover] = useState(false)
  const s = STATUS[status] || STATUS.draft
  const isAI = status === 'draft' || status === 'flagged'
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid ' + (isAI ? 'var(--ai-border)' : 'var(--border-default)'),
        background: 'var(--surface-card)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          padding: 'var(--space-4) var(--space-6)',
          background: isAI ? 'var(--ai-bg)' : 'var(--surface-sunken)',
          borderBottom: '1px solid ' + (isAI ? 'var(--ai-border)' : 'var(--border-subtle)'),
        }}
      >
        {heading ? (
          <span
            style={{
              fontSize: 'var(--text-label-size)',
              letterSpacing: 'var(--text-label-ls)',
              textTransform: 'uppercase',
              fontWeight: 'var(--text-label-weight)',
              color: 'var(--text-secondary)',
            }}
          >
            {heading}
          </span>
        ) : null}
        <Badge tone={s.tone} icon={s.icon}>
          {s.label}
        </Badge>
        <span
          style={{
            flex: 1,
          }}
        />
        {isAI ? <ConfidenceIndicator level={confidence} /> : null}
      </header>
      <div
        style={{
          padding: 'var(--space-6)',
          fontFamily: 'var(--font-serif)',
          fontSize: 'var(--text-body-lg-size)',
          lineHeight: 'var(--text-body-lg-lh)',
          color: 'var(--text-body)',
          maxWidth: 'var(--measure-prose)',
        }}
      >
        {children}
      </div>
      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-4) var(--space-6)',
          borderTop: '1px solid var(--border-subtle)',
          opacity: hover || status === 'flagged' ? 1 : 0.72,
          transition: 'opacity var(--duration-fast) var(--ease-standard)',
        }}
      >
        <button
          type={'button'}
          onClick={onShowEvidence}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 'var(--text-small-size)',
            color: 'var(--text-link)',
          }}
        >
          <Icon name={'link'} size={13} />
          {evidenceCount + (evidenceCount === 1 ? ' source' : ' sources')}
        </button>
        <span
          style={{
            flex: 1,
          }}
        />
        {onEdit ? (
          <Button variant={'ghost'} size={'sm'} iconLeft={'pencil'} onClick={onEdit}>
            {'Edit'}
          </Button>
        ) : null}
        {onAccept && status !== 'accepted' ? (
          <Button variant={'secondary'} size={'sm'} iconLeft={'check'} onClick={onAccept}>
            {'Accept'}
          </Button>
        ) : null}
      </footer>
    </article>
  )
}
export { AIDraftBlock }
