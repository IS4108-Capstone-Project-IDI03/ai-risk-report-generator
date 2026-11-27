// The Buildings view's colour key (CP-61, redesign round 2): one quiet pill with the colours as a
// strip, so it never wraps into stray lines; pressing it lists each colour, its name and how many
// locations wear it, in a popover (a sheet on a phone). Rendered by BuildingStack.tsx; the counts
// come from ../buildingStack.ts (stackKey).
import { useState } from 'react'
import { Icon, Popover } from '../../../design-system'
import { stackKey, type StackCell } from '../buildingStack'

const TITLE = 'Worst severity at each location'

/** Returns the key's pill and, when pressed, its popover of colours and counts. */
export function StackKey({ cells }: { cells: StackCell<unknown>[] }) {
  const [open, setOpen] = useState(false)
  const key = stackKey(cells)
  return (
    <div className="bs-key">
      <Popover
        open={open}
        onOpenChange={setOpen}
        ariaLabel={TITLE}
        align="left"
        surfaceClassName="bs-key-pop"
        sheetClassName="bs-key-sheet"
        trigger={
          <button
            type="button"
            className="bs-key-button"
            aria-label="Colour key"
            onClick={() => setOpen(!open)}
          >
            <span className="bs-key-strip" aria-hidden="true">
              {key.map((k) => (
                <span key={k.tone} className="bs-swatch" data-tone={k.tone} />
              ))}
            </span>
            {'Colour key'}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        }
      >
        <div className="bs-key-body">
          {/* The sheet has its own title on a phone; the popover names it here. */}
          <p className="bs-key-title">{TITLE}</p>
          <ul aria-label={TITLE}>
            {key.map((k) => (
              <li key={k.tone}>
                <span className="bs-swatch" data-tone={k.tone} aria-hidden="true" />
                <span>{k.label}</span>
                <b>{k.count}</b>
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </div>
  )
}
