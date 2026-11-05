// Tag picker menu (CP-23, board 07): Whole client, then SITES, then ASSESSMENTS.
// Called by document rows, inside a Popover opened from a TagPill. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type TagOption = {
  value: string
  label: string
  // Whole client (default), a site or an assessment; sets the group and the icon.
  group?: 'client' | 'site' | 'assessment'
}

export type TagPickerProps = {
  options: TagOption[]
  value?: string
  onChange: (value: string) => void
  // Phone sheet (board 23): plain radio rows, no group headings or icons.
  radios?: boolean
}

export const GROUPS = [
  { group: 'client', heading: '', icon: 'briefcase' },
  { group: 'site', heading: 'Sites', icon: 'map-pin' },
  { group: 'assessment', heading: 'Assessments', icon: 'clipboard-list' },
] as const

/** Returns the menu; the chosen option is ticked and onChange gets its value. */
export function TagPicker({ options, value, onChange, radios = false }: TagPickerProps) {
  // One tab stop: the chosen option, or the first when none is chosen.
  const stop = options.some((o) => o.value === value) ? value : options[0]?.value
  // Up/Down/Home/End move focus between options; the selected one is scrolled into view.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role=option]'))
    const at = items.indexOf(document.activeElement as HTMLElement)
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key]
    if (to === undefined) return
    event.preventDefault()
    const target = items[Math.min(Math.max(to, 0), items.length - 1)]
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
  }
  return (
    <div
      className={radios ? 'ds-menu ds-menu--radios' : 'ds-menu'}
      role="listbox"
      aria-label="Tag"
      onKeyDown={onKeyDown}
    >
      {GROUPS.map(({ group, heading, icon }) => {
        const items = options.filter((o) => (o.group ?? 'client') === group)
        if (!items.length) return null
        return (
          <div key={group} role="group" aria-label={heading || undefined}>
            {heading && !radios ? <div className="ds-menu-label">{heading}</div> : null}
            {items.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                tabIndex={o.value === stop ? 0 : -1}
                ref={(el) => {
                  if (el && o.value === value) el.scrollIntoView?.({ block: 'nearest' })
                }}
                className="ds-menu-item"
                onClick={() => onChange(o.value)}
              >
                {radios ? (
                  <span className="ds-radio-dot" data-on={o.value === value || undefined}>
                    {o.value === value ? <Icon name="check" size={14} /> : null}
                  </span>
                ) : (
                  <Icon name={icon} size={16} />
                )}
                <span className="ds-menu-text" title={o.label}>
                  {o.label}
                </span>
                {o.value === value && !radios ? <Icon name="check" size={16} /> : null}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
