// Collapsible checklist (F-12, NEW v2 pattern): groups that open to rows with checkboxes. A group's
// box ticks all of its rows (half-ticked when only some are). Each row can carry a mark at the right
// edge and one hover action. It knows nothing about what the rows are: the caller owns the ticks.
// Called by feature screens (Settings > Walkthroughs). Calls Checkbox, Icon, RowMark.
import { useId, useState, type ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { RowMark, type MarkKind } from '../display/RowMark'
import { Checkbox } from './Checkbox'
import './checklist-groups.css'

export type ChecklistItem = {
  id: string
  name: string
  // The one mark at the row's right edge (a green done tick); `markLabel` is what a screen reader hears.
  mark?: MarkKind
  markLabel?: string
}
export type ChecklistGroup = { id: string; name: string; items: ChecklistItem[] }

export type ChecklistGroupsProps = {
  groups: ChecklistGroup[]
  // The ticked item ids; the caller keeps them.
  selected: string[]
  onSelectedChange: (ids: string[]) => void
  // The row's hover action (a round icon button). Its column is reserved, so nothing shifts.
  renderAction?: (item: ChecklistItem) => ReactNode
  // What the items are called, for the count's spoken form ("5 walkthroughs").
  noun?: string
  label?: string
}

/** Returns the groups as a list of closed rows that open to their items. */
export function ChecklistGroups({
  groups,
  selected,
  onSelectedChange,
  renderAction,
  noun = 'items',
  label,
}: ChecklistGroupsProps) {
  // Groups start closed; this holds the ids of the open ones.
  const [open, setOpen] = useState<string[]>([])
  const base = useId()
  const toggle = (id: string) =>
    setOpen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  // Ticks or unticks a set of items without disturbing the rest.
  const tick = (ids: string[], on: boolean) =>
    onSelectedChange(
      on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)),
    )

  return (
    <ul className="ds-cg" aria-label={label}>
      {groups.map((group) => {
        const ids = group.items.map((item) => item.id)
        const count = ids.filter((id) => selected.includes(id)).length
        const isOpen = open.includes(group.id)
        const panel = `${base}-${group.id}`
        return (
          <li key={group.id} className="ds-cg-group" data-open={isOpen ? '' : undefined}>
            <div className="ds-cg-grow">
              {/* The chevron is a mouse target only; the group's name is the keyboard button. */}
              <button
                type="button"
                className="ds-cg-chev"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => toggle(group.id)}
              >
                <Icon name="chevron-right" size={16} />
              </button>
              <Checkbox
                style={{ gap: 0 }}
                label={<span className="ds-sr-only">{`Select all in ${group.name}`}</span>}
                checked={count === ids.length && ids.length > 0}
                indeterminate={count > 0 && count < ids.length}
                onChange={(on) => tick(ids, on)}
              />
              <button
                type="button"
                className="ds-cg-gname"
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => toggle(group.id)}
              >
                {group.name}
                {/* A plain span cannot carry a label, so the spoken count is its own hidden text. */}
                <span className="ds-cg-count" aria-hidden="true">
                  {ids.length}
                </span>
                <span className="ds-sr-only">{`, ${ids.length} ${noun}`}</span>
              </button>
            </div>
            {/* Closed rows stay in the page so they can animate shut, but nothing can reach them. */}
            <div id={panel} className="ds-cg-collapse" inert={!isOpen} aria-hidden={!isOpen}>
              <ul className="ds-cg-items">
                {group.items.map((item) => (
                  <li key={item.id} className="ds-cg-row">
                    <Checkbox
                      label={<span className="ds-cg-name">{item.name}</span>}
                      checked={selected.includes(item.id)}
                      onChange={(on) => tick([item.id], on)}
                    />
                    <span className="ds-cg-action">{renderAction?.(item)}</span>
                    <span className="ds-cg-mark">
                      {item.mark && <RowMark kind={item.mark} label={item.markLabel} />}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
