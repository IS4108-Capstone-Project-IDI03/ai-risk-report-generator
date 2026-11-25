// The "Set by an admin" chip for what the person may not change. S-01 AC1.
// It is the design system's View only chip. A section shows it once, in the title bar's end slot
// (pass that slot as `into`); with no `into` it is drawn where it is put (beside one setting).
import { createPortal } from 'react-dom'
import { ViewOnlyChip } from '../../../design-system'

export function SetByAdmin({ into }: { into?: HTMLElement | null }) {
  const chip = <ViewOnlyChip>Set by an admin</ViewOnlyChip>
  if (into === undefined) return chip
  // The slot exists one render after the section's first, so it is null until then.
  return into ? createPortal(chip, into) : null
}
