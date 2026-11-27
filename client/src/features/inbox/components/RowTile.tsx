// The 32 px tile that shows what an Inbox item is about (F-10, boards 01 and 02): the type's
// icon on its colour, grey once the item is Done. The shared IconTile. Used by InboxRow on a desktop.
import { IconTile, type IconTileTone } from '../../../design-system'
import type { InboxRowModel } from '../row'

// The row's tone words, as IconTile names them.
const TONE: Record<InboxRowModel['tone'], IconTileTone> = {
  blue: 'ink',
  violet: 'violet',
  red: 'danger',
  amber: 'warn',
  grey: 'neutral',
}

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
  return <IconTile icon={icon} tone={done ? 'neutral' : TONE[tone]} className="inbox-tile" />
}
