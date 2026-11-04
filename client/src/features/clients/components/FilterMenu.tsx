// A filter pill that opens its choices (CP-23, board 05 and 07): Report due,
// Jurisdiction, Status, Tag. Called by ClientList, SitesTab and DocumentsTab.
// Calls FilterPill and Popover; the menu is the Tag picker's look (.ds-menu).
import { useState } from 'react'
import { FilterPill, Icon, Popover } from '../../../design-system'

export type Choice = { value: string; label: string }

export function FilterMenu({
  name,
  choices,
  value,
  onChange,
}: {
  // The pill's text when nothing is chosen, e.g. "Status".
  name: string
  choices: Choice[]
  // The chosen value, or '' for all.
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = choices.find((c) => c.value === value)
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={`Filter by ${name.toLowerCase()}`}
      align="left"
      surfaceClassName="cl-filter-menu"
      trigger={
        <FilterPill
          label={chosen ? chosen.label : name}
          aria-label={chosen ? `${name}: ${chosen.label}` : name}
          aria-haspopup="listbox"
          data-active={chosen ? '' : undefined}
          onClick={() => setOpen(!open)}
        />
      }
    >
      <div className="ds-menu" role="listbox" aria-label={name}>
        {[{ value: '', label: `All` }, ...choices].map((c) => (
          <button
            key={c.value}
            type="button"
            role="option"
            aria-selected={c.value === value}
            className="ds-menu-item"
            onClick={() => pick(c.value)}
          >
            <span className="ds-menu-text">{c.label}</span>
            {c.value === value ? <Icon name="check" size={16} /> : null}
          </button>
        ))}
      </div>
    </Popover>
  )
}
