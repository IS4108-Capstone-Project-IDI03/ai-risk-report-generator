// An observation's recordings (CP-03, CP-08, CP-24): one shared recording row each, in the walk
// list's grey rounded list.
// Rendered by screens/ObservationPage.tsx. Calls RecordCard, RecordingItem.
import type { ObservationRowView } from '../useObservationsView'
import { RecordCard } from './RecordCard'
import { RecordingItem } from './RecordingItem'

/** Returns the Recordings card. */
export function RecordingsCard({ o, phone }: { o: ObservationRowView; phone: boolean }) {
  return (
    // "Recordings · 2", as the Photos and Handwritten Pages cards count theirs.
    <RecordCard
      title={o.recordings.length ? 'Recordings · ' + o.recordings.length : 'Recordings'}
      label="Recordings"
    >
      {o.recordings.length > 0 && (
        <ul className="sw-list cpp-list">
          {o.recordings.map((r) => (
            <RecordingItem key={r.id} r={r} phone={phone} />
          ))}
        </ul>
      )}
    </RecordCard>
  )
}
