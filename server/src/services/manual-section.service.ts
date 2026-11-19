// A standard entered clause by clause (IN-18), for one with no PDF to upload:
// the draft document here; its clauses, screenshots and Publish follow.
// A manual document never goes through the ingestion queue: each clause is
// indexed as it is saved (ingestion-service app/manual.py).
import { z } from 'zod'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { documentDetailsSchema, recordFields, toDtoOf } from './knowledge-document.service'

// The details a manual entry starts from: those of a standard (FM, NFPA or
// local), never a past report. Edition and standard number are required, as for
// any standard, since matching the real PDF later relies on them (IN-07).
export const manualDocumentSchema = documentDetailsSchema.refine(
  (details) => details.sourceType !== 'marsh_report',
  { message: 'Only a standard can be entered manually.', path: ['sourceType'] },
)
export type ManualDocumentDetails = z.infer<typeof manualDocumentSchema>

// Another manual entry of this standard and edition already exists (one per
// standard, shared by every admin): a 409 naming it so the client can link to it.
export class ManualEntryExistsError extends Error {
  constructor(
    readonly documentId: string,
    label: string,
    draft: boolean,
  ) {
    super(
      draft
        ? `${label} is already being entered. Continue editing that entry.`
        : `${label} is already entered manually. Edit its clauses instead.`,
    )
    this.name = 'ManualEntryExistsError'
  }
}

// Matching's identity, tidied as ingestion tidies it (app/matching.py `_number`, `_body`).
const tidy = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/\s+/g, '')

/**
 * Creates a manual draft from its details and returns it (IN-18). Refuses with
 * ManualEntryExistsError when a draft or published manual entry of the same
 * standard and edition exists; one withdrawn (replaced) doesn't count.
 */
export async function createManualDocument(details: ManualDocumentDetails) {
  const fields = recordFields(details)
  const others = await KnowledgeDocumentModel.find(
    {
      entryMethod: 'manual',
      withdrawn: { $exists: false },
      'metadata.source_type': details.sourceType,
      edition: fields.edition,
    },
    'issuingBody standardNumber edition status',
  ).lean()
  const same = others.find(
    (o) =>
      tidy(o.standardNumber) === tidy(fields.standardNumber) &&
      tidy(o.issuingBody) === tidy(fields.issuingBody),
  )
  if (same) {
    const label = [fields.issuingBody, fields.standardNumber].filter(Boolean).join(' ')
    throw new ManualEntryExistsError(
      String(same._id),
      `${label} (${fields.edition})`,
      same.status === 'draft',
    )
  }
  const created = await KnowledgeDocumentModel.create({
    ...fields,
    entryMethod: 'manual',
    status: 'draft',
    manualSeq: 0,
    unconfirmed: [],
  })
  return toDtoOf(created.toObject())
}
