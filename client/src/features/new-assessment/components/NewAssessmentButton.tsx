// "New assessment" (CP-23, boards 03 and 05): one navy button whose menu offers the
// two starts, each with its tile. Used by the Assessments toolbar and the Clients
// screens. Calls the design system's Popover; callers get the chosen StartMode.
import { useEffect, useRef, useState } from 'react'
import { Button, Icon, Popover, Sheet, useIsPhone } from '../../../design-system'
import './new-assessment-button.css'

export type StartMode = 'form' | 'documents'
const STARTS: { mode: StartMode; icon: string; label: string; note: string; tile: string }[] = [
  {
    mode: 'form',
    icon: 'pencil-line',
    label: 'Fill in the form',
    note: 'Enter the client, sites and dates yourself.',
    tile: 'nab-tile--form',
  },
  {
    mode: 'documents',
    icon: 'file-up',
    label: 'Start from client documents',
    note: 'Add their emails and letters. The form fills itself in.',
    tile: 'nab-tile--docs',
  },
]

/** Returns the New assessment button and its menu; `onStart` gets the chosen start. */
export function NewAssessmentButton({ onStart }: { onStart: (mode: StartMode) => void }) {
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
      aria-haspopup="menu"
      onClick={() => setOpen(!open)}
    >
      {'New assessment'}
    </Button>
  )
  // A phone gets the board 21 sheet: two two-line rows and a 48 px Cancel, no close icon.
  if (phone)
    return (
      <>
        {trigger}
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="New assessment"
          actions={STARTS.map((s) => ({
            label: s.label,
            description: s.note,
            icon: s.icon,
            onSelect: () => {
              setOpen(false)
              onStart(s.mode)
            },
          }))}
        />
      </>
    )
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="New assessment"
      align="right"
      className="nab-anchor"
      surfaceClassName="nab-menu"
      trigger={trigger}
    >
      <ul ref={list} className="nab-list">
        {STARTS.map((s) => (
          <li key={s.mode}>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onStart(s.mode)
              }}
            >
              <span className={'nab-tile ' + s.tile}>
                <Icon name={s.icon} size={18} />
              </span>
              <span className="nab-text">
                <strong>{s.label}</strong>
                <span>{s.note}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
