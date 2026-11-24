// The whole checklist beside the recording on a wide screen (CP-37 AC2): the sheet's own body,
// scrolling by itself. Called by screens/SiteObservation.tsx; on a phone the sheet is used.
import { answerPlace } from '../locations'
import { ChecklistBody } from './ChecklistSheet'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'

export function ChecklistPane({ v }: { v: AssessmentWorkflow }) {
  return (
    <aside className="cap-checklist-pane" aria-label="Checklist">
      <h2 className="cap-checklist-pane-title">Checklist</h2>
      <p className="cap-checklist-pane-note">{answerPlace(v.currentLocation)}</p>
      {/* Keyed so it reads the checklist again once a difference is recorded and saved. */}
      <ChecklistBody key={v.fChecklistItem?.id ?? 'none'} v={v} />
    </aside>
  )
}
