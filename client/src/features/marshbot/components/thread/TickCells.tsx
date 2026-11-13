// What is already fine, as even cells of ticks (AS-06 canvas C10, S1, S3): a solid green tick
// centred on the name and its short line, and a small bar only where the cell has one (checklist
// areas). Cells wrap to another row rather than clip a name. On a soft green band when the card
// has nothing else to show. A bar is pinned to its cell's bottom, so the bars of a row share one
// line whatever the titles take. Used by RowsCard and ChecklistCard.
import type { TickCell } from '../../types'
import { DoneTick } from './DoneTick'
import { SegBar } from './SegBar'

/** Returns the row of tick cells; nothing when there are none. */
export function TickCells({ cells, band = false }: { cells: TickCell[]; band?: boolean }) {
  if (!cells.length) return null
  return (
    <ul className="mbt-ticks" data-band={band || undefined}>
      {cells.map((c) => (
        <li key={c.title} data-bar={c.bar ? '' : undefined}>
          <DoneTick />
          <span>
            <b>{c.title}</b>
            {c.detail && <small>{c.detail}</small>}
            <span className="mbt-sr">, done</span>
          </span>
          {c.bar && <SegBar covered={c.bar.covered} total={c.bar.total} />}
        </li>
      ))}
    </ul>
  )
}
