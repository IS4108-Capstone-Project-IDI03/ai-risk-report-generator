// The Edit details dialog (KB-01): corrects one document's details (AC6, AC7)
// or restores a previous version (AC10). A detail still Unconfirmed (IN-05)
// opens empty and marked, and must be filled in before saving. A refused value shows its reason under the field and nothing is saved; any
// other failure shows its reason above the fields. Opened by
// screens/KnowledgeDocuments.tsx; saves through api.ts.
import { Button, Callout, Dialog } from '../../../design-system'
import type { DocumentVersion, KnowledgeDocument } from '../api'
import { dateTime } from '../display'
import { useDetailsForm } from '../useDetailsForm'
import { DetailsFields } from './DetailsFields'

/** Returns the Edit details dialog, filled from the document or a version. */
export function EditDetailsDialog({
  document,
  version,
  onClose,
  onSaved,
}: {
  document: KnowledgeDocument
  version?: DocumentVersion
  onClose: () => void
  onSaved: (updated: KnowledgeDocument) => void
}) {
  const { details, errors, problem, busy, change, save } = useDetailsForm(document, version)

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit details"
      description={document.fileName}
      width={600}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => save(onSaved)}>
            Save details
          </Button>
        </>
      }
    >
      <div className="kb-edit">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Details not saved">
              {problem}
            </Callout>
          </div>
        )}
        {version && (
          <p className="kb-edit-note">
            Filled in with the version replaced {dateTime(version.replacedAt)} by{' '}
            {version.replacedBy.name}. Check the details, then save to restore them.
          </p>
        )}
        <DetailsFields
          details={details}
          errors={errors}
          unconfirmed={version ? [] : document.unconfirmed}
          onChange={change}
        />
      </div>
    </Dialog>
  )
}
