import { Button, Callout, Dialog } from '../../../design-system'
import { answerPlace } from '../locations'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useChecklist } from '../useChecklist'
import { caption } from '../checklistChecks'
import { ChecklistItems } from './ChecklistItems'

// The checklist over the capture screen (CP-31 AC1): the Checklist tab's own
// view, answered where capture is. Choosing standards and regenerating stay on
// the tab. It loads each time it opens, so it shows the checklist as it is now.
// ChecklistBody is shared with ChecklistPane, the same list beside the recording (CP-37).
/** Returns the checklist as it is answered on site: loading, error, empty or the items. */
export function ChecklistBody({ v }: { v: AssessmentWorkflow }) {
  const reference = v.captureRef
  const { view, setView, loadError, reload } = useChecklist(reference)
  const location = v.currentLocation
  if (loadError)
    return (
      <Callout tone="danger" title="The checklist could not be loaded">
        {loadError}
      </Callout>
    )
  if (!view) return <p style={caption}>Loading the checklist…</p>
  if (!view.checklist)
    return (
      <Callout tone="info" title="No checklist yet">
        Generate one on the assessment&apos;s Checklist tab, then open it here.
      </Callout>
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p style={caption}>
        The checklist is built on the Checklist tab.{' '}
        <Button variant="link" size="sm" onClick={v.goToChecklistTab}>
          Rebuild it
        </Button>
      </p>
      <ChecklistItems
        key={view.checklist.id}
        reference={reference}
        view={{ ...view, checklist: view.checklist }}
        setView={setView}
        reload={reload}
        answering={
          v.canAnswerChecklist
            ? {
                place: { kind: 'site', location, choose: v.chooseLocationForChecklist },
                onSaved: v.checklistSaved,
                onFullCapture: v.differInCapture,
              }
            : null
        }
        regenerateHint="Regenerate it on the Checklist tab."
        onViewObservation={v.showObservation}
      />
    </div>
  )
}

export function ChecklistSheet({ v }: { v: AssessmentWorkflow }) {
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Checklist"
      description={answerPlace(v.currentLocation)}
      width={760}
      onClose={v.closeChecklist}
    >
      <ChecklistBody v={v} />
    </Dialog>
  )
}
