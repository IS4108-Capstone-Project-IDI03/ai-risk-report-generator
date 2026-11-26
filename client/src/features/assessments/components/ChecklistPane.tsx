// The whole checklist beside New Observation's form on a wide screen (CP-37 AC2): the right half
// of the page, its sections the Checklist tab's own white cards (.cl-cards), scrolling inside
// itself under its title. Called by screens/SiteObservation.tsx; on a phone the sheet is used.
import { Button } from '../../../design-system'
import { answerPlace } from '../locations'
import { ChecklistBody } from './ChecklistSheet'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'

export function ChecklistPane({ v }: { v: AssessmentWorkflow }) {
  return (
    <aside className="cap-checklist-pane" aria-label="Checklist">
      <div className="cap-checklist-pane-head">
        <h2 className="cap-checklist-pane-title">Checklist</h2>
        {/* Building and regenerating stay on the tab; this is the way there. */}
        <Button variant="link" size="sm" iconRight="arrow-right" onClick={v.goToChecklistTab}>
          Rebuild it on the Checklist tab
        </Button>
      </div>
      {/* Only once a place is chosen: where answers go. Before that the form's Location says it. */}
      {v.currentLocation && (
        <p className="cap-checklist-pane-note">{answerPlace(v.currentLocation)}</p>
      )}
      <div className="cap-checklist-pane-body cl-cards">
        {/* Keyed so it reads the checklist again once a difference is recorded and saved. */}
        <ChecklistBody key={v.fChecklistItem?.id ?? 'none'} v={v} link={false} />
      </div>
    </aside>
  )
}
