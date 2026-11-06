// The 32 px tile that shows what an Inbox item is about (F-10, boards 01 and 02): the type's
// icon on its colour, grey once the item is Done. Used by InboxRow on a desktop.
import { Icon } from '../../../design-system'
import type { InboxRowModel } from '../row'

/** Returns the icon tile; a Done item's tile is grey whatever its type. */
export function RowTile({
  icon,
  tone,
  done,
}: {
  icon: string
  tone: InboxRowModel['tone']
  done: boolean
}) {
  return (
    <span className="inbox-tile" data-tone={done ? 'grey' : tone}>
      <Icon name={icon} size={16} />
    </span>
  )
}
