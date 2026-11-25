// An observation's recordings (CP-03, CP-08, CP-24): one shared recording row each, in the walk
// list's grey rounded list. A sample observation's clip is played in this demo by one button.
// Rendered by screens/ObservationPage.tsx. Calls RecordCard, RecordingItem.
import { Icon } from '../../../design-system'
import type { ObservationRowView } from '../useObservationsView'
import { RecordCard } from './RecordCard'
import { RecordingItem } from './RecordingItem'

/** Returns the Recordings card. */
export function RecordingsCard({
  o,
  phone,
  playSample,
}: {
  o: ObservationRowView
  phone: boolean
  playSample: () => void
}) {
  return (
    <RecordCard title="Recordings">
      {o.recordings.length > 0 && (
        <ul className="sw-list cpp-list">
          {o.recordings.map((r) => (
            <RecordingItem key={r.id} r={r} phone={phone} />
          ))}
        </ul>
      )}
      {o.hasAudio && (
        <button
          type="button"
          className="ob-button ob-button--tinted ob-button--small"
          onClick={playSample}
        >
          <Icon name="play" size={14} />
          {o.audioLabel}
        </button>
      )}
    </RecordCard>
  )
}
