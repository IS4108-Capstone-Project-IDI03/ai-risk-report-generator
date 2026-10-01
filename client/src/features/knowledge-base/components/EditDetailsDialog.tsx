// The Edit details dialog (KB-01): corrects one document's details (AC6, AC7)
// or restores a previous version (AC10), using the upload form's fields. A
// refused value shows its reason under the field and nothing is saved; any
// other failure shows its reason above the fields. Opened by
// screens/KnowledgeDocuments.tsx; saves through api.ts.
import { useState } from 'react'
import { Button, Callout, Dialog } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  correctKnowledgeDocument,
  type DocumentDetails,
  type DocumentVersion,
  type KnowledgeDocument,
  type StoredDetails,
} from '../api'
import { dateTime } from '../display'
import { editionProblem, withSourceType } from '../uploads'
import { DetailsFields } from './DetailsFields'

// The form's values for stored details. A standard's "all" facility type is
// the form's blank "All facility types" choice.
function formDetails(d: StoredDetails): DocumentDetails {
  const standard = d.sourceType !== 'marsh_report'
  return {
    sourceType: d.sourceType,
    title: d.title,
    edition: d.edition ?? '',
    effectiveDate: d.effectiveDate,
    jurisdiction: d.jurisdiction,
    facilityType: standard && d.facilityType === 'all' ? '' : d.facilityType,
  }
}

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
  const [details, setDetails] = useState(() => formDetails(version ?? document))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Same rule as an upload row: changing the source type starts that type's
  // own fields afresh; an edited field's old error no longer applies.
  const change = (next: Partial<DocumentDetails>) => {
    const base =
      next.sourceType !== undefined && next.sourceType !== details.sourceType
        ? withSourceType(details, next.sourceType)
        : details
    setDetails({ ...base, ...next })
    setErrors(Object.fromEntries(Object.entries(errors).filter(([field]) => !(field in next))))
  }

  const save = async () => {
    // A bad edition is caught here, so nothing is sent.
    const edition = editionProblem(details)
    if (edition) {
      setErrors({ edition })
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      onSaved(await correctKnowledgeDocument(document.id, details))
    } catch (error: unknown) {
      const refused = error instanceof GatewayError && error.status === 400
      setErrors(refused ? error.fields : {})
      setProblem(
        error instanceof GatewayError && error.status === null
          ? 'The gateway could not be reached, so the details were not saved. Try again.'
          : refused && Object.keys(error.fields).length > 0
            ? null
            : error instanceof Error
              ? error.message
              : 'The details were not saved.',
      )
      setBusy(false)
    }
  }

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
          <Button variant="primary" loading={busy} onClick={save}>
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
        <DetailsFields details={details} errors={errors} onChange={change} />
      </div>
    </Dialog>
  )
}
