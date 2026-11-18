// View only chip (GN-13, NEW pattern): a quiet grey pill with an eye, in place of a button the
// viewer can never press (an admin on someone else's assessment). No reason box: the line beside
// it says why. Used by Generation's checkpoint header.
import { Icon } from '../core/Icon'
import './steps.css'

/** Returns the chip; its words default to "View only". */
export function ViewOnlyChip({ children = 'View only' }: { children?: string }) {
  return (
    <span className="ds-viewonly">
      <Icon name="eye" size={15} />
      {children}
    </span>
  )
}
