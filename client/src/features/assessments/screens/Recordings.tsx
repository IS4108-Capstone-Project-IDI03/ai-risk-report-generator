// All Recordings (CP-12): every recording kept on this assessment's
// observations except a deleted observation's, as All Photos and All
// Handwritten Pages list theirs, each playable in place with its transcript
// to open, searched by it and filtered (CP-13). A transcript is corrected on its
// observation's page, which the observation's text opens. Opened from the
// location navigator; rendered by AssessmentApp.
import { EmptyState } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { plural } from '../reviewDisplay'
import { RecordingTable } from '../components/RecordingTable'
import { evidenceMenus, matchesEvidence, RECORDING_FILTER } from '../evidenceFilters'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

export function Recordings({ v }: { v: AssessmentWorkflow }) {
  const recordings = v.recordingCollection
  return (
    <div className="ob">
      <ScreenHeader title="All Recordings" back="Observations" onBack={v.goObservations} />
      {recordings.length === 0 ? (
        <EmptyState
          icon="mic"
          title="No recordings yet"
          description="Recordings appear here once they are saved with an observation."
        />
      ) : (
        <RecordingTable
          rows={recordings}
          count={`${plural(recordings.length, 'recording')} across ${plural(new Set(recordings.map((r) => r.where)).size, 'location')}`}
          search={{
            query: v.evidenceQuery,
            onQuery: v.setEvidenceQuery,
            noun: 'recording',
            label: 'Search recordings',
          }}
          filters={{
            menus: evidenceMenus(v, recordings, RECORDING_FILTER),
            values: v.evidenceFilters,
            onChoose: v.setEvidenceFilter,
            onClear: v.clearEvidenceFilters,
            matches: matchesEvidence,
          }}
        />
      )}
    </div>
  )
}
