// Small tags for an observation's kinds and labels (CP-36): none when untagged (a Fact by default).
// A Recommendation or Info request that also states a fact shows a "+ Fact" segment.
// Rendered by ObservationRow, screens/ObservationPage and the site walk proposal rows.
import { Icon } from '../../../design-system'
import type { Kind } from '../api'
import { chipsOf, KIND_ICON, KIND_LABEL, LABEL_ICON } from '../noteKinds'
import '../kind-picker.css'

/** Returns one tag per kind and per label, or nothing when there are none. */
export function KindBadges({ kinds, labels }: { kinds?: Kind[] | null; labels?: string[] | null }) {
  const chips = chipsOf(kinds ?? [])
  if (!chips.length && !labels?.length) return null
  return (
    <span className="kp-badges">
      {chips.map((k, i) => (
        <span key={k} className="kp-badge">
          <Icon name={KIND_ICON[k]} size={12} />
          {KIND_LABEL[k]}
          {i === 0 && kinds?.includes('fact') && <span className="kp-seg">{'+ Fact'}</span>}
        </span>
      ))}
      {labels?.map((l) => (
        <span key={l} className="kp-badge">
          <Icon name={LABEL_ICON} size={12} />
          {l}
        </span>
      ))}
    </span>
  )
}
