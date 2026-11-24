// Small badges for an observation's tags (CP-36): none when untagged (a Fact by default).
// Rendered by ObservationRow, screens/ObservationPage and the site walk proposal rows.
import type { Kind } from '../api'
import { KIND_LABEL } from '../noteKinds'
import '../kind-picker.css'

/** Returns one small badge per tag, or nothing when there are none. */
export function KindBadges({ kinds }: { kinds?: Kind[] | null }) {
  if (!kinds?.length) return null
  return (
    <span className="kp-badges">
      {kinds.map((k) => (
        <span key={k} className="kp-badge" data-kind={k}>
          {KIND_LABEL[k]}
        </span>
      ))}
    </span>
  )
}
