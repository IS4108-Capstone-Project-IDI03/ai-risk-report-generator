import { useState } from 'react'
import { Icon, IconButton, Popover } from '../../../design-system'

export type MoreMenuItem = { label: string; icon: string; onSelect: () => void }

// The assessment's occasional actions (version history, archiving), kept out of
// the header behind one ⋯ button so the main action stands alone.
export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="More actions"
      align="right"
      surfaceClassName="om-more-menu"
      trigger={
        <IconButton
          icon="ellipsis"
          label="More actions"
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
    </Popover>
  )
}
