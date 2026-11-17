// Custom dropdown (listbox) for one AI task's model. S-01 AC3, AC4, AC7, AC8.
// Called by ModelRow. A native select cannot show a light beside each option.
// Keys: Up/Down/Home/End move, Enter or Space chooses, Escape closes.
import { useId, useRef, useState } from 'react'
import type * as React from 'react'
import { Icon } from '../../../design-system'
import type { ModelOption } from '../api'

// Colour is never the only signal: the text says whether a key is set.
function Light({ on }: { on: boolean }) {
  return (
    <span className="st-keyinfo">
      <span className={`st-light ${on ? 'st-light--on' : 'st-light--off'}`} aria-hidden="true" />
      {on ? 'Key set' : 'No API key'}
    </span>
  )
}

function optionText(o: ModelOption) {
  return o.label + (o.recommended ? ' (recommended)' : '')
}

type Props = {
  label: string
  options: ModelOption[]
  selected: string
  disabled: boolean
  onChoose: (id: string) => void
}

export function ModelSelect({ label, options, selected, disabled, onChoose }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find((o) => o.id === selected)

  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.id === selected),
      ),
    )
    setOpen(true)
  }
  // A greyed option with selectable=false does nothing; without this guard a
  // no-key model could be saved (the server would refuse it anyway).
  const choose = (o: ModelOption) => {
    if (!o.selectable) return
    setOpen(false)
    if (o.id !== selected) onChoose(o.id)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    const move = (to: number) => {
      event.preventDefault()
      if (!open) show()
      else setActive((to + options.length) % options.length)
    }
    if (event.key === 'ArrowDown') move(active + 1)
    else if (event.key === 'ArrowUp') move(active - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(options.length - 1)
    else if (event.key === 'Escape') setOpen(false)
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(options[active])
      else show()
    }
  }

  return (
    <div
      className="st-select"
      ref={root}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        className="st-select-button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span>{current ? optionText(current) : 'Choose a model'}</span>
        {current && <Light on={current.keySet} />}
        <Icon name="chevron-down" size={16} color="var(--text-muted)" />
      </button>
      {open && (
        <ul role="listbox" id={`${id}-list`} aria-label={label} className="st-list">
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.id === selected}
              aria-disabled={!o.selectable || undefined}
              data-active={i === active || undefined}
              data-greyed={o.greyed || undefined}
              className="st-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <span className="st-option-main">
                <span>{optionText(o)}</span>
                <Light on={o.keySet} />
              </span>
              {o.note && <span className="st-option-note">{o.note}</span>}
              {o.id === selected && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
