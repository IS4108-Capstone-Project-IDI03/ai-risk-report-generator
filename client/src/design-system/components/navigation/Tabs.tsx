import type * as React from 'react'
import { Icon } from '../core/Icon'
export type TabsProps = {
  // `alert` turns the count into an amber pill that asks for attention, and is
  // read out after the label (e.g. "1 needs review").
  items?: { value: string; label: string; icon?: string; count?: number; alert?: string }[]
  value?: string | number
  onChange?: (value: string) => void
  // Icons only on narrow screens (styles.css): each tab keeps its name for
  // screen readers.
  compact?: boolean
  style?: React.CSSProperties
}
function Tabs({ items = [], value, onChange, compact = false, style = {} }: TabsProps) {
  return (
    <div
      className={compact ? 'ds-tabs ds-tabs-compact' : 'ds-tabs'}
      role="tablist"
      aria-label="View"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 'var(--space-7)',
        borderBottom: '1px solid var(--border-default)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      {items.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            aria-label={
              t.alert
                ? `${t.label}, ${t.alert}`
                : compact
                  ? t.label + (t.count != null ? ' ' + t.count : '')
                  : undefined
            }
            title={compact ? t.label : undefined}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const current = items.findIndex((item) => item.value === t.value)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) %
                      items.length
              onChange?.(items[next].value)
              ;(event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()
            }}
            type={'button'}
            onClick={() => onChange && onChange(t.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              padding: '0 0 15px',
              marginBottom: -1,
              border: 'none',
              background: 'transparent',
              borderBottom: '2px solid ' + (active ? 'var(--action-primary)' : 'transparent'),
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'inherit',
              fontSize: 'var(--text-body-size)',
              fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              cursor: 'pointer',
              transition: 'var(--transition-control)',
            }}
          >
            {t.icon ? <Icon name={t.icon} size={14} /> : null}
            <span className="ds-tab-label">{t.label}</span>
            {t.count != null ? (
              <span
                style={
                  t.alert
                    ? {
                        minWidth: 20,
                        padding: '1px var(--space-3)',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--amber-100)',
                        color: 'var(--amber-700)',
                        fontSize: 'var(--text-caption-size)',
                        fontWeight: 'var(--weight-semibold)',
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'center',
                      }
                    : {
                        fontSize: 'var(--text-caption-size)',
                        color: 'var(--text-muted)',
                        fontWeight: 'var(--weight-regular)',
                      }
                }
              >
                {t.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
export { Tabs }
