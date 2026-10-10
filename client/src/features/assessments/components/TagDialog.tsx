import { Button, Callout, Dialog, Select, Textarea } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CategoryPicker } from './CategoryPicker'

// Edits an observation: its tags (CP-06), the COPE categories, severity,
// location and standard, and its note (CP-08), saved together. A bottom sheet
// on phones, a dialog on wider screens.
export function TagDialog({ v }: { v: AssessmentWorkflow }) {
  if (!v.tagEdit) return null
  return (
    <Dialog
      className="ds-dialog-sheet"
      open={v.tagOpen}
      title="Edit observation"
      description="Tags cover everything captured in this observation. The note is saved exactly as you type it."
      width={520}
      onClose={v.closeTags}
      footer={
        <>
          <Button variant="secondary" disabled={v.tagBusy} onClick={v.closeTags}>
            {'Cancel'}
          </Button>
          <Button variant="primary" loading={v.tagBusy} onClick={v.saveTags}>
            {'Save changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!v.tagError && (
          <div role="alert">
            <Callout tone="warning" title="Changes not saved">
              {v.tagError}
            </Callout>
          </div>
        )}
        <CategoryPicker cats={v.tagEdit.cats} onToggle={v.toggleTagCat} />
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
        <Textarea
          label="Note"
          rows={5}
          maxLength={5000}
          value={v.tagEdit.note}
          onChange={v.setTag('note')}
        />
      </div>
    </Dialog>
  )
}
