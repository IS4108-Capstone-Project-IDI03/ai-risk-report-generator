import { Button, Callout, Dialog } from '../../../design-system'
import { locationLabel } from '../locations'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useChecklist } from '../useChecklist'
import { caption } from '../checklistChecks'
import { ChecklistItems } from './ChecklistItems'

// The checklist over the capture screen (CP-31 AC1): the Checklist tab's own
// view, answered where capture is. Choosing standards and regenerating stay on
// the tab. It loads each time it opens, so it shows the checklist as it is now.
export function ChecklistSheet({ v }: { v: AssessmentWorkflow }) {
  const reference = v.captureRef
  const { view, setView, sections, loadError, reload } = useChecklist(reference)
  const location = v.currentLocation
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Checklist"
      description={
        location
          ? 'Answers are saved at ' + locationLabel(location) + '.'
          : 'Choose where you are to confirm items or record differences.'
      }
      width={760}
      onClose={v.closeChecklist}
    >
      {loadError ? (
        <Callout tone="danger" title="The checklist could not be loaded">
          {loadError}
        </Callout>
      ) : !view ? (
        <p style={caption}>Loading the checklist…</p>
      ) : !view.checklist ? (
        <Callout tone="info" title="No checklist yet">
          Generate one on the assessment&apos;s Checklist tab, then open it here.
        </Callout>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={caption}>
            Standards are chosen on the Checklist tab.{' '}
            <Button variant="link" size="sm" onClick={v.goToChecklistTab}>
              Change standards
            </Button>
          </p>
          <ChecklistItems
            key={view.checklist.id}
            reference={reference}
            view={{ ...view, checklist: view.checklist }}
            sections={sections}
            setView={setView}
            reload={reload}
            answering={
              v.canAnswerChecklist
                ? {
                    place: {
                      kind: 'site',
                      location,
                      choose: v.chooseLocationForChecklist,
                    },
                    onSaved: v.checklistSaved,
                    onFullCapture: v.differInCapture,
                  }
                : null
            }
            regenerateHint="Regenerate it on the Checklist tab."
            onViewObservation={v.showObservation}
          />
        </div>
      )}
    </Dialog>
  )
}
