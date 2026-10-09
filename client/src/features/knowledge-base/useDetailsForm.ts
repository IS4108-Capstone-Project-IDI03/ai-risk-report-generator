// The state and Save details logic of the details form, shared by the Edit
// details dialog (KB-01) and the Review page's Confirm details step (IN-07).
// A refused value shows its reason under the field; any other failure shows
// its reason above the fields. Calls api.ts.
import { useState } from 'react'
import { GatewayError } from '../assessments/api'
import {
  correctKnowledgeDocument,
  type DocumentDetails,
  type DocumentVersion,
  type KnowledgeDocument,
} from './api'
import { editionProblem, FACILITY_UNSET, formDetails, withSourceType } from './details'

/** Returns the form's values and errors, `change` for a field and `save` for Save details. */
export function useDetailsForm(document: KnowledgeDocument, version?: DocumentVersion) {
  const [details, setDetails] = useState(() =>
    formDetails(version ?? document, version ? [] : document.unconfirmed),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Same rule as an upload row: changing the source type starts that type's
  // own fields afresh; an edited field's old error no longer applies.
  // Choosing the source type of a document that had none keeps the other
  // details, since they were read from the document, not defaulted.
  const change = (next: Partial<DocumentDetails>) => {
    const base =
      next.sourceType !== undefined && next.sourceType !== details.sourceType && details.sourceType
        ? withSourceType(details, next.sourceType)
        : details
    setDetails({ ...base, ...next })
    setErrors(Object.fromEntries(Object.entries(errors).filter(([field]) => !(field in next))))
  }

  // Saves the details and hands the stored document to `onSaved`.
  const save = async (onSaved: (updated: KnowledgeDocument) => void) => {
    // A bad edition is caught here, so nothing is sent.
    const edition = editionProblem(details)
    if (edition) {
      setErrors({ edition })
      return
    }
    // A standard's facility type still not chosen; a report's blank one is
    // refused by the gateway with its own message.
    if (details.facilityType === FACILITY_UNSET) {
      setErrors({ facilityType: 'Choose a facility type.' })
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
    } finally {
      setBusy(false)
    }
  }

  return { details, errors, problem, busy, change, save }
}
