// The Note / Voice / Photo / Scan switch of New Observation, with a count on a tab that holds
// something ("Voice 2") so nothing waits unseen behind another tab (CP-02, CP-24).
// Called by screens/SiteObservation.tsx.
import { SegmentedControl } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../capture.css'

type Mode = 'note' | 'voice' | 'photo' | 'scan'

export function CaptureModeSwitcher({ v }: { v: AssessmentWorkflow }) {
  const value: Mode = v.isVoiceMode
    ? 'voice'
    : v.isPhotoMode
      ? 'photo'
      : v.isScanMode
        ? 'scan'
        : 'note'
  const pick = { note: v.modeNote, voice: v.modeVoice, photo: v.modePhoto, scan: v.modeScan }
  return (
    <div className="cap-modes" data-walk="new-observation.modes">
      <SegmentedControl<Mode>
        ariaLabel="Capture as"
        options={[
          { value: 'note', label: 'Note' },
          {
            value: 'voice',
            label: 'Voice',
            count: v.voiceCount,
            walk: 'new-observation.mode-voice',
          },
          { value: 'photo', label: 'Photo', count: v.photoCount },
          { value: 'scan', label: 'Scan', count: v.pageCount },
        ]}
        value={value}
        onChange={(mode) => pick[mode]()}
      />
    </div>
  )
}
