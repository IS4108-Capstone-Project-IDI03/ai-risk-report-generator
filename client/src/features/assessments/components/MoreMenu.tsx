import { useState } from 'react'
import { Icon, IconButton, Popover } from '../../../design-system'

export type MoreMenuItem = {
  label: string
  icon: string
  onSelect: () => void
  disabled?: boolean
}

// A screen's occasional actions (an assessment's version history and
// archiving, a client's rename and removal), kept out of the header behind
// one ⋯ button so the main action stands alone. An action the user can't take
// shows disabled, with the reason in `notes` below.
// `label` names the ⋯ button, e.g. "More actions for NUS" on a list of many.
export function MoreMenu({
  items,
  notes = [],
  label = 'More actions',
}: {
  items: MoreMenuItem[]
  notes?: string[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="More actions"
      align="right"
      surfaceClassName={notes.length ? 'om-more-menu has-notes' : 'om-more-menu'}
      trigger={
        <IconButton
          icon="ellipsis"
          label={label}
          size="md"
          selected={open}
          onClick={() => setOpen(!open)}
        />
      }
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2)' }}>
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className="om-more-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              <Icon name={item.icon} size={16} color="var(--text-secondary)" />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {notes.map((note) => (
        <p key={note} className="om-more-note">
          <Icon name="info" size={16} color="var(--text-muted)" />
          <span>{note}</span>
        </p>
      ))}
    </Popover>
  )
}
