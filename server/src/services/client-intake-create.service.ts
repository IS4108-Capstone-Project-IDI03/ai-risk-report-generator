// Create from a client intake (CP-23 AC10, AC11): the engineer's checked form
// becomes the client, sites and assessments, and each document they kept is
// copied under the client where they placed it. Called by
// routes/client-intake.routes.ts. Calls assessment-batch.service.ts (createAll)
// and storage.service.ts.
import { z } from 'zod'
import { Types } from 'mongoose'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientIntakeModel, type IClientIntake } from '../models/client-intake.model'
import { SiteModel } from '../models/site.model'
import {
  AssessmentFieldsError,
  createAll,
  createdBefore,
  type CreatedAssessments,
  type Made,
  type NewAssessments,
} from './assessment-batch.service'
import type { SessionUser } from './auth.service'
import { clientDocumentKey } from './client-document.service'
import { deleteIntakeFiles, IntakeError, ownIntake } from './client-intake.service'
import * as storage from './storage.service'

// Where each kept document goes: the whole client, a site or an assessment of
// the form, by its ref. A file left out is not kept (AC13).
export const intakeDocumentsSchema = z
  .array(
    z.object({
      fileId: z.string('Choose a document.'),
      placement: z
        .discriminatedUnion(
          'kind',
          [
            z.object({ kind: z.literal('client') }),
            z.object({ kind: z.literal('site'), ref: z.string() }),
            z.object({ kind: z.literal('assessment'), ref: z.string() }),
          ],
          'Choose where the document belongs.',
        )
        // A document added by hand without a tag is kept under the whole client (AC12).
        .default({ kind: 'client' }),
    }),
  )
  .max(100)
  .default([])
export type IntakeDocuments = z.infer<typeof intakeDocumentsSchema>

type StoredIntake = IClientIntake & { _id: Types.ObjectId }

// Every document names one of the intake's files once, and a ref on the form;
// checked before anything is created.
function checkDocuments(intake: StoredIntake, input: NewAssessments, documents: IntakeDocuments) {
  const fields: Record<string, string> = {}
  const fileIds = new Set(intake.files.map((f) => String(f._id)))
  const seen = new Set<string>()
  const siteRefs = new Set(input.sites.map((s) => s.ref))
  const visitRefs = new Set(input.sites.flatMap((s) => s.assessments.map((a) => a.ref)))
  documents.forEach(({ fileId, placement }, i) => {
    if (!fileIds.has(fileId) || seen.has(fileId))
      fields[`documents.${i}.fileId`] = 'This document is not one of those added.'
    seen.add(fileId)
    const refs = placement.kind === 'site' ? siteRefs : visitRefs
    if (placement.kind !== 'client' && !refs.has(placement.ref))
      fields[`documents.${i}.placement.ref`] = `Choose a ${placement.kind} on the form.`
  })
  if (Object.keys(fields).length) throw new AssessmentFieldsError(fields)
}

// How long a Create may hold its claim before another may take it over (the
// gateway restarted mid-create).
const CLAIM_STALE_MS = 120_000

/**
 * Creates the form's records, keeps each listed document under the client
 * where it was placed (AC11), deletes the intake's files and marks it created,
 * in steps a-d. Returns the client's id and the assessments; a repeat after
 * success returns the same records (the response was lost). A failure removes
 * everything it made and leaves the intake ready to try again. Throws
 * AssessmentFieldsError (400), or IntakeError 404, or 409 while it is being
 * read or another Create of it is running.
 */
export async function createFromIntake(
  id: string,
  input: NewAssessments,
  documents: IntakeDocuments,
  user: SessionUser,
): Promise<CreatedAssessments> {
  const owned = await ownIntake(id, user)
  if (owned.status === 'created')
    return createdBefore(
      owned.created!.clientId!,
      Object.values(owned.created!.assessmentIds!),
      user,
    )
  if (owned.status === 'reading')
    throw new IntakeError('These documents are still being read. Try again shortly.', 409)
  checkDocuments(owned, input, documents)

  // a. Claim it, so two taps create once: without this, both would make every
  // site, assessment and document twice.
  const intake = await ClientIntakeModel.findOneAndUpdate(
    {
      _id: owned._id,
      $or: [
        { status: { $in: ['uploaded', 'ready', 'failed'] } },
        { status: 'creating', updatedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      ],
    },
    { status: 'creating' },
    { returnDocument: 'before' },
  ).lean<StoredIntake>()
  if (!intake)
    throw new IntakeError('These assessments are already being created. Try again shortly.', 409)

  let made: Made | undefined
  let documentIds: Record<string, string> = {}
  let created: CreatedAssessments
  try {
    // b. The records, then c. the documents with them; a failure in either
    // removes both (createAll).
    created = await createAll(input, user, async (m) => {
      made = m
      documentIds = await keepDocuments(intake, input, documents, m, user)
    })
  } catch (error) {
    // Released with an empty ledger, so a retry can claim it and start clean;
    // a stale claim taken over goes back to ready.
    const previous = intake.status === 'creating' ? 'ready' : intake.status
    await ClientIntakeModel.updateOne(
      { _id: intake._id },
      { status: previous, $unset: { created: 1 } },
    )
    throw error
  }
  // d. Done: what was made is kept first so a repeat returns it. Outside the
  // try: once createAll has returned, a failure here must never release the
  // intake, or a retry would make everything twice.
  await ClientIntakeModel.updateOne(
    { _id: intake._id },
    { status: 'created', created: { ...made, documentIds } },
  )
  // The intake's own copies go (AC13); a failure is logged, the cleanup job retries.
  await deleteIntakeFiles(intake).catch((error: unknown) =>
    console.error('Could not delete the intake files:', error),
  )
  return created
}

// Copies each kept document under the client and records it where it was
// placed. Returns their ids by file id. A failure deletes the copies and
// records it made, then rethrows, so createAll removes the rest.
async function keepDocuments(
  intake: StoredIntake,
  input: NewAssessments,
  documents: IntakeDocuments,
  { clientId, siteIds, assessmentIds }: Made,
  user: SessionUser,
): Promise<Record<string, string>> {
  const siteOfRef = Object.fromEntries(input.sites.map((s) => [s.ref, s.id ?? siteIds[s.ref]]))
  const siteOfVisit = Object.fromEntries(
    input.sites.flatMap((s) => s.assessments.map((a) => [a.ref, siteOfRef[s.ref]])),
  )
  const sites = new Map(
    (
      await SiteModel.find(
        { _id: { $in: Object.values(siteOfRef) } },
        'jurisdiction facilityType',
      ).lean()
    ).map((s) => [String(s._id), s]),
  )
  const documentIds: Record<string, string> = {}
  const keys: string[] = []
  try {
    for (const { fileId, placement } of documents) {
      const _id = new Types.ObjectId()
      const file = intake.files.find((f) => String(f._id) === fileId)!
      const siteId =
        placement.kind === 'site'
          ? siteOfRef[placement.ref]
          : placement.kind === 'assessment'
            ? siteOfVisit[placement.ref]
            : undefined
      const site = siteId ? sites.get(siteId) : undefined
      const key = clientDocumentKey(clientId, _id, file.ext)
      await storage.copyObject(file.key, key)
      keys.push(key)
      const now = new Date()
      await ClientDocumentModel.create({
        _id,
        client: clientId,
        placement: {
          kind: placement.kind,
          site: siteId,
          assessment: placement.kind === 'assessment' ? assessmentIds[placement.ref] : undefined,
        },
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        sha256: file.sha256,
        key,
        origin: 'intake',
        uploaded: { at: now, by: { id: user.id, name: user.name } },
        metadata: {
          source_type: 'client_document',
          jurisdiction: site?.jurisdiction ?? null,
          facility_type: site?.facilityType ?? null,
          COPE_dimension: null,
          effective_date: now,
        },
      })
      documentIds[fileId] = String(_id)
    }
    return documentIds
  } catch (error) {
    // Without this, a retry would list each document twice on the client page.
    await Promise.all([
      ClientDocumentModel.deleteMany({ _id: { $in: Object.values(documentIds) } }),
      ...keys.map((key) => storage.deleteObject(key)),
    ]).catch((cleanupError: unknown) =>
      console.error('Could not remove the documents a failed create kept:', cleanupError),
    )
    throw error
  }
}
