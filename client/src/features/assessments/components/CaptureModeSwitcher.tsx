// The Note / Voice / Photo / Scan switcher of the capture screen, each mode with its count (CP-02).
// Called by screens/SiteObservation.tsx.
import { Icon } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../capture.css'

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')

// Each mode says what it holds, so nothing waits unseen behind another. The
// count is plain text beside the name: no badge.
export function CaptureModeSwitcher({ v }: { v: AssessmentWorkflow }) {
  const modes = [
    {
      name: 'Note',
      on: v.isNoteMode,
      pick: v.modeNote,
      label: v.noteWritten ? 'Note, written' : 'Note',
      done: v.noteWritten,
    },
    {
      name: 'Voice',
      on: v.isVoiceMode,
      pick: v.modeVoice,
      label: v.voiceCount ? 'Voice, ' + plural(v.voiceCount, 'recording') : 'Voice',
      count: v.voiceCount,
    },
    {
      name: 'Photo',
      on: v.isPhotoMode,
      pick: v.modePhoto,
      label: v.photoCount ? 'Photo, ' + plural(v.photoCount, 'photo') : 'Photo',
      count: v.photoCount,
    },
    {
      name: 'Scan',
      on: v.isScanMode,
      pick: v.modeScan,
      label: v.pageCount ? 'Scan, ' + plural(v.pageCount, 'page') : 'Scan',
      count: v.pageCount,
    },
  ]
  return (
    <div role="group" aria-label="Capture as" className="cap-modes">
      {modes.map((m) => (
        <button
          key={m.name}
          type="button"
          onClick={m.pick}
          aria-pressed={m.on}
          aria-label={m.label}
        >
          {m.name}
          {m.done && <Icon name="circle-check" size={16} color="var(--marsh-navy)" />}
          {!!m.count && <span className="cap-modes-count">{m.count}</span>}
        </button>
      ))}
    </div>
  )
}
