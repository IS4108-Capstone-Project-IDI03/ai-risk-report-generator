// One Inbox row (F-10, boards 01, 02, 07 and 08): the tick, the tile, three lines of words
// (two on a phone), the due date, the time and the bin. The whole row is pressable and opens
// the item; the tick and the bin are separate buttons above it, so none is inside another.
// Used by InboxList. Calls row.ts for the words, and ReportDue for the due date.
import { IconButton, ReportDue } from '../../../design-system'
import type { Notification } from '../../notifications/api'
import { formatInboxWhen } from '../../notifications/formatWhen'
import type { Phase } from '../useInbox'
import { rowOf } from '../row'
import { RowTile } from './RowTile'
import { TickButton } from './TickButton'

export type InboxRowProps = {
  item: Notification
  tab: 'todo' | 'done'
  phase?: Phase
  // Arrived while the screen was open: fades in and holds a blue tint.
  fresh: boolean
  // Some row in the list has a due date, so every row keeps that column (the date cell and
  // the time then line up row to row).
  dueColumn: boolean
  phone: boolean
  onOpen: (item: Notification) => void
  // Ticks a To do row, unticks a Done one.
  onTick: (item: Notification) => void
  onBin: (item: Notification) => void
}

/** Returns the row's list item. */
export function InboxRow({
  item,
  tab,
  phase,
  fresh,
  dueColumn,
  phone,
  onOpen,
  onTick,
  onBin,
}: InboxRowProps) {
  const row = rowOf(item)
  // Ticked: Done and idle, or a tick that is playing. A bin leaves the row as it was.
  const on =
    phase && phase !== 'leaving' ? phase === 'ticking' || phase === 'ticked' : tab === 'done'
  const tickLabel = `${on ? 'Move back to To do' : 'Mark done'}: ${row.phoneTask} ${row.phoneDetail}`
  const showBin = !phone || tab === 'done'
  return (
    <li
      className="inbox-row"
      data-id={item.id}
      data-tab={tab}
      data-phase={phase}
      data-done={on || undefined}
      data-fresh={fresh || undefined}
    >
      <div className="inbox-row__inner">
        <div className="inbox-row__line">
          <TickButton
            on={on}
            label={tickLabel}
            onClick={() => onTick(item)}
            ring={phone ? { icon: row.icon, tone: row.tone } : undefined}
          />
          {!phone && <RowTile icon={row.icon} tone={row.tone} done={on} />}
          <button type="button" className="inbox-row__main" onClick={() => onOpen(item)}>
            {!phone && <span className="inbox-row__sender">{row.sender}</span>}
            <span className="inbox-row__task">{phone ? row.phoneTask : row.task}</span>
            <span className="inbox-row__detail">{phone ? row.phoneDetail : row.detail}</span>
          </button>
          {tab === 'todo' && dueColumn && (
            <span className="inbox-row__due">
              {row.showsDue && <ReportDue date={row.due} short={phone} />}
            </span>
          )}
          <span className="inbox-row__end">
            <time dateTime={item.createdAt}>{formatInboxWhen(item.createdAt)}</time>
            {showBin && (
              <span className="inbox-bin-slot">
                <IconButton
                  icon="trash-2"
                  label={`Remove ${row.phoneTask} ${row.phoneDetail}`}
                  tooltip="Remove"
                  // The bin is red (v2 section 2); its size is the screen's (inbox.css).
                  style={{
                    color: 'var(--red-600)',
                    borderRadius: '50%',
                    width: 'var(--inbox-bin)',
                    height: 'var(--inbox-bin)',
                  }}
                  onClick={() => onBin(item)}
                />
              </span>
            )}
          </span>
        </div>
      </div>
    </li>
  )
}
