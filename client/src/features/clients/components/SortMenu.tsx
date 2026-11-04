// The Sort pill (CP-23 round 12, board 05): a grey pill naming the current order that
// opens the ways to order the table. Called by ClientList. Calls SortPill and Popover.
import { useState } from 'react'
import { Icon, Popover } from '../../../design-system'
import { SortPill } from '../../assessments/components/SortPill'
import type { Choice } from './FilterMenu'

export function SortMenu({
  choices,
  value,
  onChange,
}: {
  choices: (Choice & { icon?: string })[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Sort clients"
      align="right"
      className="cl-sort-anchor"
      surfaceClassName="cl-filter-menu"
      trigger={
        <SortPill
          name="Sort clients"
          label={choices.find((c) => c.value === value)?.label ?? ''}
          onClick={() => setOpen(!open)}
        />
      }
    >
      <div className="ds-menu" role="listbox" aria-label="Sort by">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="option"
            aria-selected={c.value === value}
            className="ds-menu-item"
            onClick={() => {
              onChange(c.value)
              setOpen(false)
            }}
          >
            {c.icon && <Icon name={c.icon} size={16} />}
            <span className="ds-menu-text">{c.label}</span>
            {c.value === value ? <Icon name="check" size={16} /> : null}
          </button>
        ))}
      </div>
    </Popover>
  )
}
