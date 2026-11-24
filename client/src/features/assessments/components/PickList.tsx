// A quiet dropdown with a search box and checkboxes; what is picked lists below it, one
// line each with a small x (CP-37). Called by ChecklistBuild. Calls nothing; the parent owns the picks.
import { useState } from 'react'
import { Checkbox, Icon, IconButton, Input, Popover } from '../../../design-system'
import '../checklist.css'

export type PickOption = { id: string; label: string }

/** Returns one section's dropdown and its chosen list. */
export function PickList({
  label,
  options,
  picked,
  onChange,
  disabled,
}: {
  // Names the dropdown button, e.g. "Codes and standards".
  label: string
  options: PickOption[]
  picked: Set<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    onChange(next)
  }
  return (
    <div>
      <Popover
        open={open}
        onOpenChange={setOpen}
        ariaLabel={label}
        surfaceClassName="cl-pick-pop"
        trigger={
          <button
            type="button"
            className="cl-pick-btn"
            disabled={disabled}
            aria-label={`${label}: ${picked.size} of ${options.length} chosen`}
            onClick={() => setOpen(!open)}
          >
            {picked.size} of {options.length} chosen
            <Icon name="chevron-down" size={16} />
          </button>
        }
      >
        <Input
          iconLeft="search"
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="cl-pick-opts">
          {shown.map((o) => (
            <li key={o.id}>
              <Checkbox
                label={o.label}
                checked={picked.has(o.id)}
                onChange={(on) => toggle(o.id, on)}
              />
            </li>
          ))}
          {shown.length === 0 && <li className="cl-note">Nothing matches.</li>}
        </ul>
      </Popover>
      <ul className="cl-chosen" aria-label={`Chosen: ${label}`}>
        {options
          .filter((o) => picked.has(o.id))
          .map((o) => (
            <li key={o.id}>
              <span>{o.label}</span>
              <IconButton
                icon="x"
                size="sm"
                label={`Remove ${o.label}`}
                disabled={disabled}
                onClick={() => toggle(o.id, false)}
              />
            </li>
          ))}
      </ul>
    </div>
  )
}
