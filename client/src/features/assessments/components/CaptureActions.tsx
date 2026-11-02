// The Save observation footer of the capture screen (CP-02).
// Called by screens/SiteObservation.tsx.
import { Callout, Icon } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../capture.css'

// Save observation, where the engineer finishes: at the foot of the details
// panel, or pinned to the bottom of a stacked page above a phone's home
// indicator. Leaving is the back button's, at the top.
export function CaptureActions({ v, pinned }: { v: AssessmentWorkflow; pinned: boolean }) {
  const saving = v.fSaving || v.captureStarting
  return (
    <div className={'cap-actions' + (pinned ? ' cap-actions--pinned' : '')}>
      {!!v.fToast && (
        <div
          role="status"
          className="cap-toast"
          style={{
            background: v.fToast.warn ? 'var(--status-moderate-bg)' : 'var(--status-low-bg)',
            color: v.fToast.warn ? 'var(--status-moderate-fg)' : 'var(--status-low-fg)',
          }}
        >
          <Icon name={v.fToast.warn ? 'triangle-alert' : 'circle-check'} size={16}></Icon>
          <span>{v.fToast.text}</span>
        </div>
      )}
      {!!v.fSaveError && (
        <div role="alert">
          <Callout tone="warning" title={v.fSaveError.title}>
            {v.fSaveError.message}
          </Callout>
        </div>
      )}
      <button
        type="button"
        className="cap-btn cap-btn--primary"
        disabled={saving}
        aria-busy={saving}
        onClick={v.saveObservation}
      >
        <Icon name="check" size={16} />
        {v.proposalCapture ? 'Add to site walk' : 'Save observation'}
      </button>
    </div>
  )
}
