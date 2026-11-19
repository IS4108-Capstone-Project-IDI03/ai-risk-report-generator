// "Enter a standard manually" (IN-18): a standard's details, for one with no PDF
// to upload, such as an edition only readable online. Start entering creates the
// draft and opens its clauses. When the same standard and edition is already being
// entered, it says so and offers that entry instead (one per standard, shared by
// every admin). Start from copies another edition's clauses in the knowledge
// base, each to check before Publish. Opened from screens/AddDocuments.tsx;
// calls api.ts.
import { useEffect, useState } from 'react'
import { Button, Callout, Dialog, Select } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  createManualDocument,
  listIngestedDocuments,
  type DocumentDetails,
  type KnowledgeDocument,
} from '../api'
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

// Matching's identity, tidied as the gateway tidies it: case and spaces don't count.
const tidy = (value: string | null) => (value ?? '').toLowerCase().replace(/\s+/g, '')

// The editions a new entry can start from: the same standard (type, issuing body for a
// local one, number) in the knowledge base, another edition, not a draft.
function editionsOf(documents: KnowledgeDocument[], details: DocumentDetails) {
  if (!details.sourceType || !details.standardNumber.trim()) return []
  return documents.filter(
    (d) =>
      d.status === 'complete' &&
      d.sourceType === details.sourceType &&
      tidy(d.standardNumber) === tidy(details.standardNumber) &&
      (details.sourceType !== 'local_standard' ||
        tidy(d.issuingBody) === tidy(details.issuingBody)) &&
      d.edition !== details.edition,
  )
}
const editionLabel = (d: KnowledgeDocument) =>
  `${d.title} (${[d.edition && `${d.edition} edition`, d.entryMethod === 'manual' && 'entered manually'].filter(Boolean).join(', ')})`

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
  // The knowledge base, read once, for Start from; empty if it can't be read.
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [copyFrom, setCopyFrom] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    listIngestedDocuments(controller.signal).then(setDocuments, () => undefined)
    return () => controller.abort()
  }, [])
  const editions = editionsOf(documents, details)
  // A choice that no longer fits the details typed is dropped.
  const from = editions.some((d) => d.id === copyFrom) ? copyFrom : ''

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
      onOpen((await createManualDocument(details, from || undefined)).id)
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
        {editions.length > 0 && (
          <Select
            label="Start from"
            hint="Copies its clauses into this entry, each to check against this edition."
            options={[
              { value: '', label: 'A blank entry' },
              ...editions.map((d) => ({ value: d.id, label: editionLabel(d) })),
            ]}
            value={from}
            onChange={(e) => setCopyFrom(e.target.value)}
          />
        )}
      </div>
    </Dialog>
  )
}
