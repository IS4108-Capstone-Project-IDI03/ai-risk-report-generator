// The done mark (AS-06 round 7): a solid green disc with a white tick, the one look for "done"
// in every card. Used by TickCells, OutlineCard, LanesCard, BarsCard and RowEnd.
import type { CSSProperties } from 'react'
import { Icon } from '../../../../design-system'

/** Returns the done mark as a disc of `size` px (cards.css .mbt-stick); the tick is 60% of it. */
export function DoneTick({ size = 22 }: { size?: number }) {
  return (
    <span className="mbt-stick" style={{ '--d': `${size}px` } as CSSProperties} aria-hidden="true">
      <Icon name="check" size={Math.round(size * 0.6)} color="var(--text-inverse)" />
    </span>
  )
}
