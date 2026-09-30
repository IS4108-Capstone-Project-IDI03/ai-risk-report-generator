import { Button, Callout, Dialog, Select } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// Changes an observation's tags (CP-06): its COPE category, severity, location
// and standard. A bottom sheet on phones, a dialog on wider screens.
export function TagDialog({ v }: { v: AssessmentWorkflow }) {
  if (!v.tagEdit) return null
  return (
    <Dialog
      className="ds-dialog-sheet"
      open={v.tagOpen}
      title="Edit tags"
      description="Tags cover everything captured in this observation."
      width={440}
      onClose={v.closeTags}
      footer={
        <>
          <Button variant="secondary" disabled={v.tagBusy} onClick={v.closeTags}>
            {'Cancel'}
          </Button>
          <Button variant="primary" loading={v.tagBusy} onClick={v.saveTags}>
            {'Save tags'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!v.tagError && (
          <div role="alert">
            <Callout tone="warning" title="Tags not saved">
              {v.tagError}
            </Callout>
          </div>
        )}
        <Select
          label="COPE category"
          hint={v.tagCatHint}
          options={v.tagCatOptions}
          value={v.tagEdit.cat}
          onChange={v.setTag('cat')}
        />
        <Select
          label="Severity"
          options={v.tagSevOptions}
          value={v.tagEdit.sev}
          onChange={v.setTag('sev')}
        />
        <Select
          label="Location"
          options={v.tagLocOptions}
          value={v.tagEdit.locationId}
          onChange={v.setTag('locationId')}
        />
        <Select
          label="Standard reference"
          hint="Optional. The draft cites the matching clause from this standard."
          options={v.tagStdOptions}
          value={v.tagEdit.std}
          onChange={v.setTag('std')}
        />
      </div>
    </Dialog>
  )
}
