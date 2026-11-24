// Cancel and Save observation of New Observation (CP-02, CP-24). On a wide screen they sit in the
// left card under Severity, so they never move when the right card grows; on a phone they are
// the bar at the bottom of the screen. Called by screens/SiteObservation.tsx.
import { Button, Callout, FormActionBar } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../capture.css'

// Why the last save failed, kept above the buttons until the next try.
function SaveError({ v }: { v: AssessmentWorkflow }) {
  if (!v.fSaveError) return null
  return (
    <div role="alert">
      <Callout tone="warning" title={v.fSaveError.title}>
        {v.fSaveError.message}
      </Callout>
    </div>
  )
}

export function CaptureActions({ v, pinned }: { v: AssessmentWorkflow; pinned: boolean }) {
  const saving = v.fSaving || v.captureStarting
  const label = v.proposalCapture ? 'Add to site walk' : 'Save observation'
  if (pinned)
    return (
      <>
        <div className="cap-page-error">
          <SaveError v={v} />
        </div>
        <FormActionBar
          onCancel={v.leaveCapture}
          primaryLabel={label}
          onPrimary={v.saveObservation}
          primaryLoading={saving}
          primaryWalk="new-observation.save"
        />
      </>
    )
  return (
    <div className="cap-foot">
      <SaveError v={v} />
      <div className="cap-foot-buttons">
        <Button variant="pill" style={{ height: 40 }} onClick={v.leaveCapture}>
          {'Cancel'}
        </Button>
        <Button
          variant="create"
          iconLeft="check"
          style={{ height: 40 }}
          loading={saving}
          data-walk="new-observation.save"
          onClick={v.saveObservation}
        >
          {label}
        </Button>
      </div>
    </div>
  )
}
