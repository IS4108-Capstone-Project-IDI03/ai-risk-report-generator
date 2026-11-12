// One row of a card (AS-06 rules 3 and 4): a coloured tile with the row's icon, a 1-2 word name,
// one short status (red when something failed), the engineer's own words when the row quotes a
// note, and its RowEnd. A row that opens something opens from anywhere on it.
// Used by every card in this folder.
import { useContext } from 'react'
import { Icon } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { CardRow as Row } from '../../types'
import { RowEnd } from './RowEnd'

/** Returns the row; pressing it follows its link unless its button does something else. */
export function CardRow({ row }: { row: Row }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  const end = row.end
  const link = end.type === 'open' || (end.type === 'button' && !end.action) ? end.link : null
  // The row's own button stays the keyboard way in; the whole row is the pointer's shortcut.
  const open = link && !past ? () => bot.openLink(link) : undefined
  return (
    <div
      className="mbt-row"
      data-link={open ? '' : undefined}
      onClick={(e) => {
        // A click on the row's button is that button's; without this it would open twice.
        if (!open || (e.target as HTMLElement).closest('button')) return
        open()
      }}
    >
      <span className="mbt-tile" data-tone={row.tone} aria-hidden="true">
        <Icon name={row.icon} size={16} />
      </span>
      <span className="mbt-row-text">
        <span className="mbt-row-title">{row.title}</span>
        {/* Up to 2 lines; the title holds the whole note for a pointer. */}
        {row.quote && (
          <span className="mbt-row-quote" title={row.quote}>
            {row.quote}
          </span>
        )}
        {row.detail && (
          <span className="mbt-row-detail" data-bad={row.bad || undefined}>
            {row.detail}
          </span>
        )}
      </span>
      <RowEnd row={row} />
    </div>
  )
}
