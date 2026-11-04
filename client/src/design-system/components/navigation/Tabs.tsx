import { useEffect, useRef } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'
export type TabsProps = {
  // `alert` turns the count into an amber pill that asks for attention, and is
  // read out after the label (e.g. "1 needs review").
  // `shortLabel` stands in for a long label on a phone (styles.css); the
  // label stays the tab's accessible name.
  items?: {
    value: string
    label: string
    shortLabel?: string
    icon?: string
    count?: number
    alert?: string
  }[]
  value?: string | number
  onChange?: (value: string) => void
  // Icons only on narrow screens (styles.css): each tab keeps its name for
  // screen readers.
  compact?: boolean
  style?: React.CSSProperties
}
function Tabs({ items = [], value, onChange, compact = false, style = {} }: TabsProps) {
  // Scrolls a row too narrow for its tabs so the chosen one shows; without
  // this a phone could open on a tab that is off to the side.
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = list.current
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row || !tab) return
    const r = row.getBoundingClientRect()
    const t = tab.getBoundingClientRect()
    if (t.left < r.left) row.scrollLeft += t.left - r.left
    else if (t.right > r.right) row.scrollLeft += t.right - r.right
  }, [value])
  return (
    <div
      ref={list}
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
                  : t.count != null
                    ? `${t.label}, ${t.count}`
                    : t.shortLabel
                      ? t.label
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
            {/* data-label reserves the bold width (styles.css), so choosing a
                tab doesn't shift its neighbours. */}
            <span
              className={t.shortLabel ? 'ds-tab-label ds-tab-long' : 'ds-tab-label'}
              data-label={t.label}
            >
              {t.label}
            </span>
            {t.shortLabel && (
              <span className="ds-tab-label ds-tab-short" data-label={t.shortLabel}>
                {t.shortLabel}
              </span>
            )}
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
                        // Board 01 "Tab with count": a pill, blue on the chosen tab, grey otherwise.
                        minWidth: 20,
                        padding: '1px 7px',
                        borderRadius: 'var(--radius-pill)',
                        background: active ? 'var(--ink-100)' : 'var(--graphite-100)',
                        color: active ? 'var(--ink-700)' : 'var(--text-secondary)',
                        fontSize: 'var(--text-caption-size)',
                        fontWeight: 'var(--weight-semibold)',
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'center',
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
