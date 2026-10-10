import type * as React from 'react'
import { Icon } from '../../../design-system'

const card: React.CSSProperties = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-sm)',
}

// What one box says: a short figure, the unit it counts, and a note that
// takes a colour when it needs attention.
export type Tone = 'warning' | 'danger' | 'ok'
export type BoxContent = { value: string; unit?: string; note?: string; tone?: Tone }

const TONE_COLOUR: Record<Tone, string> = {
  warning: 'var(--status-moderate-fg)',
  danger: 'var(--status-critical-fg)',
  ok: 'var(--status-low-fg)',
}
const TONE_ICON: Record<Tone, string> = {
  warning: 'triangle-alert',
  danger: 'circle-alert',
  ok: 'circle-check',
}

// A summary box, all built alike: an icon and label, a short figure with its
// unit, and a note. One that summarises a view opens it, the whole card being
// the button. Used by the Overview and the Observations tab.
export function StatBox({
  icon,
  label,
  content,
  onOpen,
  opens,
}: {
  icon: string
  label: string
  content: BoxContent
  onOpen?: () => void
  // The tab it opens, named for screen readers.
  opens?: string
}) {
  const { value, unit, note, tone } = content
  const body = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 auto',
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            background: 'var(--surface-sunken)',
            color: 'var(--text-secondary)',
          }}
        >
          <Icon name={icon} size={15} />
        </span>
        <span
          className="om-stat-label"
          style={{
            flex: '1',
            minWidth: 0,
            fontSize: '13px',
            fontWeight: '600',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--text-muted)',
          }}
        >
          {label}
        </span>
        {onOpen && <Icon name="chevron-right" size={16} color="var(--text-muted)" />}
      </span>
      <span
        className="om-stat-figure"
        style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 8px' }}
      >
        <span
          style={{
            fontSize: '28px',
            lineHeight: '34px',
            fontWeight: '700',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: tone === 'danger' ? TONE_COLOUR.danger : 'var(--text-primary)',
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{unit}</span>}
      </span>
      {note && (
        <span
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            fontSize: '13px',
            lineHeight: '18px',
            fontWeight: tone ? '500' : '400',
            color: tone ? TONE_COLOUR[tone] : 'var(--text-muted)',
          }}
        >
          {tone && <Icon name={TONE_ICON[tone]} size={14} style={{ marginTop: '2px' }} />}
          {note}
        </span>
      )}
    </>
  )
  const style: React.CSSProperties = {
    ...card,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 16px 16px',
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    // A report past its due date is marked on the card's edge too.
    // An inset edge, so the card's content lines up with the others.
    ...(tone === 'danger' && {
      boxShadow: 'inset 0 3px 0 ' + TONE_COLOUR.danger + ', var(--shadow-sm)',
    }),
  }
  const name = [label, value, unit, note].filter(Boolean).join(', ')
  return (
    <div role="group" aria-label={label} style={{ minWidth: 0 }}>
      {onOpen ? (
        <button
          type="button"
          className="om-overview-box"
          onClick={onOpen}
          aria-label={name + '. Open ' + (opens ?? label)}
          style={{ ...style, cursor: 'pointer' }}
        >
          {body}
        </button>
      ) : (
        <div style={style}>{body}</div>
      )}
    </div>
  )
}
