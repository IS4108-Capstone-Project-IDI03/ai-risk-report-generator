// The Review page's Confirm details section (IN-07): fill in the details
// labelling left Unconfirmed, then Save details (the same save as Edit
// details, KB-01). After saving it collapses to a one-line summary with an
// Edit details button. Saving can
// create or change the match (AC5), so the page takes the refreshed document.
// Used by screens/ReviewDocument.tsx.
import { useState } from 'react'
import { Button, Callout, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { countryName, facilityName, sourceLabel } from '../display'
import { useDetailsForm } from '../useDetailsForm'
import { DetailsFields } from './DetailsFields'

function Form({
  document,
  onSaved,
  onCancel,
}: {
  document: KnowledgeDocument
  onSaved: (updated: KnowledgeDocument) => void
  onCancel?: () => void
}) {
  const { details, errors, problem, busy, change, save } = useDetailsForm(document)
  return (
    <div className="kb-review-form">
      {problem && (
        <div role="alert">
          <Callout tone="warning" title="Details not saved">
            {problem}
          </Callout>
        </div>
      )}
      <DetailsFields
        details={details}
        errors={errors}
        unconfirmed={document.unconfirmed}
        onChange={change}
      />
      <div className="kb-review-form-actions">
        <Button variant="primary" loading={busy} onClick={() => save(onSaved)}>
          Save details
        </Button>
        {onCancel && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

/** Returns the Confirm details step: the form while details are open, else a summary. */
export function ConfirmDetailsStep({
  document: d,
  onSaved,
}: {
  document: KnowledgeDocument
  onSaved: (updated: KnowledgeDocument) => void
}) {
  const [editing, setEditing] = useState(false)
  const open = d.unconfirmed.length > 0 || editing
  const saved = (updated: KnowledgeDocument) => {
    setEditing(false)
    onSaved(updated)
  }
  return (
    <section className="kb-step-panel" aria-labelledby="kb-step-confirm">
      <h3 id="kb-step-confirm">Confirm details</h3>
      {open ? (
        <>
          {d.unconfirmed.length > 0 && (
            <p className="kb-step-note">
              Some details could not be read from the file. Fill in the marked fields, then save.
            </p>
          )}
          <Form
            document={d}
            onSaved={saved}
            onCancel={d.unconfirmed.length === 0 ? () => setEditing(false) : undefined}
          />
        </>
      ) : (
        <div className="kb-summary">
          <p>
            <b>Saved.</b>{' '}
            {[
              sourceLabel(d.sourceType),
              d.standardNumber ? `${d.issuingBody ?? ''} ${d.standardNumber}`.trim() : null,
              d.edition ? `${d.edition} edition` : null,
              countryName(d.jurisdiction),
              facilityName(d.facilityType),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={IconRegistry.action.edit}
            onClick={() => setEditing(true)}
          >
            Edit details
          </Button>
        </div>
      )}
    </section>
  )
}
