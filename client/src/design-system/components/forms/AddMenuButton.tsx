// Add menu button (CP-23 New assessment, CP-24 Add observation, v2 NEW pattern): one navy button
// whose menu offers a few ways to add, each a tiled row with a note. A popover on a wide screen,
// a bottom sheet on a phone. Called by NewAssessmentButton and the Observations tab.
// Calls Button, Icon, Popover, Sheet.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../core/Button'
import { Icon } from '../core/Icon'
import { Popover } from '../feedback/Popover'
import { Sheet, useIsPhone } from '../feedback/Sheet'
import './add-menu-button.css'

export type AddMenuOption<T extends string = string> = {
  // What onChoose gets back.
  value: T
  icon: string
  label: string
  note: string
  // The tile's colour: ink (form), teal (documents) or violet (a site walk).
  tone: 'form' | 'docs' | 'walk'
}

/** Returns the button and its menu; `children` are the button's words, `onChoose` gets the chosen option's value. */
export function AddMenuButton<T extends string>({
  options,
  onChoose,
  label,
  buttonLabel,
  fullWidth,
  children,
}: {
  options: AddMenuOption<T>[]
  onChoose: (value: T) => void
  // Names the menu, and titles the phone sheet.
  label: string
  // The button's accessible name, when its words are shortened (e.g. "Add" for "Add observation").
  buttonLabel?: string
  fullWidth?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  // Opening moves focus to the first option; Popover returns it on close.
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (open) list.current?.querySelector('button')?.focus()
  }, [open])
  const trigger = (
    <Button
      variant="create"
      pill
      iconLeft="plus"
      iconRight="chevron-down"
      // Both the Popover and the phone Sheet are dialogs holding buttons, not a role=menu.
      aria-haspopup="dialog"
      // On a phone the sheet is not the Popover, which adds this itself on a wide screen.
      aria-expanded={phone ? open : undefined}
      aria-label={buttonLabel}
      fullWidth={fullWidth}
      style={fullWidth ? { height: 44 } : undefined}
      onClick={() => setOpen(!open)}
    >
      {children}
    </Button>
  )
  // The options as tiled rows: in the Popover on a wide screen, in the Sheet on a phone (board 23).
  const rows = (
    <ul ref={list} className="nab-list">
      {options.map((o) => (
        <li key={o.value}>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onChoose(o.value)
            }}
          >
            <span className={'nab-tile nab-tile--' + o.tone}>
              <Icon name={o.icon} size={18} />
            </span>
            <span className="nab-text">
              <strong>{o.label}</strong>
              <span>{o.note}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
  if (phone)
    return (
      <>
        {trigger}
        <Sheet open={open} onClose={() => setOpen(false)} title={label} cancel>
          {rows}
        </Sheet>
      </>
    )
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={label}
      align="right"
      className="nab-anchor"
      surfaceClassName="nab-menu"
      trigger={trigger}
    >
      {rows}
    </Popover>
  )
}
