// "Enter a standard manually" (IN-18): a standard's details, for one with no PDF
// to upload, such as an edition only readable online. Start entering creates the
// draft and opens its clauses. When the same standard and edition is already being
// entered, it says so and offers that entry instead (one per standard, shared by
// every admin). Opened from screens/AddDocuments.tsx; calls api.ts.
import { useState } from 'react'
import { Button, Callout, Dialog } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { createManualDocument, type DocumentDetails } from '../api'
import { editionProblem, withSourceType } from '../details'
import { DetailsFields } from './DetailsFields'

const BLANK: DocumentDetails = {
  sourceType: '',
  title: '',
  standardNumber: '',
  edition: '',
  effectiveDate: '',
  jurisdiction: '',
  facilityType: '',
  issuingBody: '',
}

/** Returns the dialog that starts a manual entry. `onOpen` opens a draft's clauses. */
export function ManualEntryDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void
  onOpen: (documentId: string) => void
}) {
  const [details, setDetails] = useState(BLANK)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  // The entry already being made of this standard and edition, offered instead.
  const [existing, setExisting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const change = (next: Partial<DocumentDetails>) => {
    const base =
      next.sourceType !== undefined && next.sourceType !== details.sourceType
        ? withSourceType(details, next.sourceType)
        : details
    setDetails({ ...base, ...next })
    setErrors(Object.fromEntries(Object.entries(errors).filter(([field]) => !(field in next))))
  }

  const start = async () => {
    const edition = editionProblem(details)
    if (edition) {
      setErrors({ edition })
      return
    }
    setBusy(true)
    setProblem(null)
    setExisting(null)
    try {
      onOpen((await createManualDocument(details)).id)
    } catch (error: unknown) {
      const fields = error instanceof GatewayError && error.status === 400 ? error.fields : {}
      setErrors(fields)
      const other = error instanceof GatewayError && error.detail.documentId
      setExisting(typeof other === 'string' ? other : null)
      setProblem(
        error instanceof GatewayError && error.status === null
          ? 'The gateway could not be reached, so nothing was created. Try again.'
          : Object.keys(fields).length > 0
            ? null
            : error instanceof Error
              ? error.message
              : 'Nothing was created. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Enter a standard manually"
      description="For a standard with no PDF to upload. You add its clauses next."
      width={600}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={start}>
            Start entering
          </Button>
        </>
      }
    >
      <div className="kb-edit">
        {problem && (
          <div role="alert">
            <Callout
              tone="warning"
              title={existing ? 'Already being entered' : 'Not created'}
              actions={
                existing ? (
                  <Button variant="secondary" size="sm" onClick={() => onOpen(existing)}>
                    Continue editing
                  </Button>
                ) : undefined
              }
            >
              {problem}
            </Callout>
          </div>
        )}
        <DetailsFields details={details} errors={errors} standardsOnly onChange={change} />
      </div>
    </Dialog>
  )
}
