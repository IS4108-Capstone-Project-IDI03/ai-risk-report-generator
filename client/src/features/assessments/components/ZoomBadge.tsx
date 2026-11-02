// The small magnifier on a picture that opens to zoom (CP-22 round 6), at the
// picture's bottom right, so a tap that zooms looks different from one that
// opens something else. Its button must be `position: relative`. Used by
// PhotoGrid.tsx, PhotoTable.tsx, PageEntry.tsx and MediaPickers.tsx.
import { Icon } from '../../../design-system'
import './zoom-badge.css'

export function ZoomBadge({ small = false }: { small?: boolean }) {
  return (
    <span className="zoom-badge" data-small={small || undefined} aria-hidden="true">
      <Icon name="zoom-in" size={small ? 11 : 13} />
    </span>
  )
}
