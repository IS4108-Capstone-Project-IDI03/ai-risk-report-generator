// A client's documents (CP-23 AC14-AC16): listed on the client page under the
// whole client, a site or an assessment, opened as the original, deleted.
// Called by routes/client.routes.ts and routes/client-document.routes.ts.
// Calls storage.service.ts for the files; created here (uploads) and by
// client-intake-create.service.ts.
import { createHash } from 'crypto'
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel, type IClientDocument } from '../models/client-document.model'
import { SiteModel } from '../models/site.model'
import type { SessionUser } from './auth.service'
import { ClientSiteError, getClient } from './client.service'
import { checkDocument } from './client-intake.service'
import * as storage from './storage.service'

export class ClientDocumentNotFoundError extends Error {
  constructor() {
    super('This document was not found.')
    this.name = 'ClientDocumentNotFoundError'
  }
}

// S3 refused to delete the file; the route answers 502 and the record stays.
export class ClientDocumentFileError extends Error {
  constructor() {
    super("Couldn't delete the file. Try again.")
    this.name = 'ClientDocumentFileError'
  }
}

type LeanDocument = IClientDocument & { _id: Types.ObjectId }

/** Returns where a client document's file is kept in S3. Shared with client-intake-create.service.ts. */
export const clientDocumentKey = (clientId: unknown, id: Types.ObjectId, ext: string) =>
  `client-documents/${clientId}/${id}.${ext}`

export type ClientDocumentDto = {
  id: string
  name: string
  contentType: string
  size: number
  placement:
    | { kind: 'client' }
    | { kind: 'site'; siteId: string; siteName: string }
    | {
        kind: 'assessment'
        assessmentId: string
        reference: string
        siteId: string
        siteName: string
      }
  // What the row and the Tag picker show: Whole client, the site's name, or "RPT-… · site".
  tag: string
  // 'intake' when created from client documents, 'upload' when added on the client page.
  origin: 'intake' | 'upload'
  originLabel: string
  uploadedAt: Date
  uploadedBy: { id: string; name: string }
}

// The client page's rule (client-page.service.ts getClientPage), document by
// document. Returns the filter of the documents the user may see: the whole client's, and
// those tagged to a site where they have an own assessment or to one of their
// own assessments. Without the narrowing, a document tagged to another
// engineer's site or assessment would be open to every engineer at the client.
async function visibleDocuments(clientId: Types.ObjectId, user: SessionUser, forChange = false) {
  const sites = await SiteModel.find({ client: clientId }, '_id').lean()
  const mine = await AssessmentModel.find(
    { site: { $in: sites.map((s) => s._id) }, ...own(user, forChange) },
    '_id site',
  ).lean()
  if (!mine.length) throw new ClientSiteError('You have no assessments for this client.', 403)
  if (user.role === 'knowledge_admin' && !forChange) return { client: clientId }
  return {
    client: clientId,
    $or: [
      { 'placement.kind': 'client' as const },
      { 'placement.kind': 'site' as const, 'placement.site': { $in: mine.map((a) => a.site) } },
      {
        'placement.kind': 'assessment' as const,
        'placement.assessment': { $in: mine.map((a) => a._id) },
      },
    ],
  }
}

// The assessments the user's client page lists: their own, or all for a knowledge
// admin who is only reading. A change (an upload, a new tag, a delete) is judged
// on their own assessments for everyone (RV-11): an admin holds assessments:edit
// now, and without this could file or delete documents at any client.
const own = (user: SessionUser, forChange = false) =>
  user.role === 'knowledge_admin' && !forChange ? {} : { engineer: user.id }
// A site still listed (CP-18): a removed one takes no documents.
const LISTED = { removed: { $exists: false } }

// The documents as DTOs: placements named from the sites and assessments they point at.
async function toDtos(documents: LeanDocument[]): Promise<ClientDocumentDto[]> {
  const [sites, assessments] = await Promise.all([
    SiteModel.find({ _id: { $in: documents.map((d) => d.placement.site) } }, 'name').lean(),
    AssessmentModel.find(
      { _id: { $in: documents.map((d) => d.placement.assessment) } },
      'reference',
    ).lean(),
  ])
  const siteName = new Map(sites.map((s) => [String(s._id), s.name]))
  const reference = new Map(assessments.map((a) => [String(a._id), a.reference]))
  return documents.map((d) => {
    const siteId = String(d.placement.site)
    const assessmentId = String(d.placement.assessment)
    const name = siteName.get(siteId) ?? ''
    const placement: ClientDocumentDto['placement'] =
      d.placement.kind === 'client'
        ? { kind: 'client' }
        : d.placement.kind === 'site'
          ? { kind: 'site', siteId, siteName: name }
          : {
              kind: 'assessment',
              assessmentId,
              reference: reference.get(assessmentId) ?? '',
              siteId,
              siteName: name,
            }
    const origin = d.origin ?? 'intake'
    return {
      id: String(d._id),
      name: d.name,
      contentType: d.contentType,
      size: d.size,
      placement,
      tag: tagLabel(placement),
      origin,
      originLabel:
        origin === 'upload' ? `Uploaded by ${d.uploaded.by.name}` : 'From client documents',
      uploadedAt: d.uploaded.at,
      uploadedBy: { id: d.uploaded.by.id, name: d.uploaded.by.name },
    }
  })
}

// What the Tag picker and the row show for a placement.
const tagLabel = (p: ClientDocumentDto['placement']) =>
  p.kind === 'client'
    ? 'Whole client'
    : p.kind === 'site'
      ? p.siteName
      : `${p.reference} · ${p.siteName}`

/**
 * Returns the client's documents, oldest first. Throws UnknownClientError for
 * an unknown client, ClientSiteError 403 when the user has no assessment there.
 */
export async function listClientDocuments(
  clientId: string,
  user: SessionUser,
): Promise<ClientDocumentDto[]> {
  const client = await getClient(clientId)
  const visible = await visibleDocuments(client._id, user)
  return toDtos(await ClientDocumentModel.find(visible).sort({ createdAt: 1 }).lean())
}

/**
 * Returns the tags a document of this client can take: the whole client, and
 * each listed site and assessment the client page shows the user (with its
 * site). Same access rule as the list.
 */
export async function listDocumentTags(
  clientId: string,
  user: SessionUser,
): Promise<{ placement: ClientPlacement; label: string }[]> {
  const client = await getClient(clientId)
  await visibleDocuments(client._id, user)
  const listed = await SiteModel.find({ client: client._id, ...LISTED }, 'name')
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean()
  const assessments = await AssessmentModel.find(
    { site: { $in: listed.map((s) => s._id) }, ...own(user) },
    'reference site',
  )
    .sort({ reference: 1 })
    .lean()
  // Only sites with an assessment shown, as the client page lists them.
  const sites = listed.filter((s) => assessments.some((a) => s._id.equals(a.site)))
  const siteName = new Map(sites.map((s) => [String(s._id), s.name]))
  return [
    { placement: { kind: 'client' }, label: 'Whole client' },
    ...sites.map((s) => ({
      placement: { kind: 'site' as const, siteId: String(s._id) },
      label: s.name,
    })),
    ...assessments.map((a) => ({
      placement: { kind: 'assessment' as const, assessmentId: String(a._id) },
      label: `${a.reference} · ${siteName.get(String(a.site))}`,
    })),
  ]
}

// A tag as the client sends it; it is checked against the client's own sites and assessments.
export const placementSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('client') }),
    z.object({ kind: z.literal('site'), siteId: z.string() }),
    z.object({ kind: z.literal('assessment'), assessmentId: z.string() }),
  ],
  'Choose where the document belongs.',
)
export type ClientPlacement = z.infer<typeof placementSchema>

// A tag in the record's shape, with the site whose jurisdiction and facility
// type the document takes (none for the whole client). Throws ClientSiteError
// 400 for a site or assessment the user's client page doesn't show (another
// client's, another engineer's, or removed): without it, a document could be
// filed where its engineer can't see it.
async function resolvePlacement(
  client: Types.ObjectId,
  tag: ClientPlacement,
  user: SessionUser,
  forChange = false,
) {
  const refuse = () => new ClientSiteError('Choose a site or assessment of this client.', 400)
  if (tag.kind === 'client') return { placement: { kind: 'client' as const } }
  const assessment =
    tag.kind === 'assessment' && isValidObjectId(tag.assessmentId)
      ? await AssessmentModel.findOne(
          { _id: tag.assessmentId, ...own(user, forChange) },
          'site',
        ).lean()
      : null
  const siteId = tag.kind === 'site' ? tag.siteId : assessment?.site
  const site =
    siteId && isValidObjectId(siteId)
      ? await SiteModel.findOne({ _id: siteId, client, ...LISTED })
      : null
  const shown =
    site &&
    (tag.kind === 'assessment'
      ? !!assessment
      : !!(await AssessmentModel.exists({ site: site._id, ...own(user, forChange) })))
  if (!shown) throw refuse()
  return {
    site,
    placement: {
      kind: tag.kind,
      site: site._id,
      assessment: assessment?._id,
    },
  }
}

// The metadata a document takes from its site (null for the whole client).
const siteMetadata = (site?: { jurisdiction: string; facilityType: string }) => ({
  jurisdiction: site?.jurisdiction ?? null,
  facility_type: site?.facilityType ?? null,
})

export type UploadedFile =
  | { name: string; status: 'kept'; document: ClientDocumentDto }
  | { name: string; status: 'refused'; reason: string }

/**
 * Keeps the files uploaded on a client's page (AC15), tagged as asked or to the
 * whole client, and returns each file kept or refused with the reason (one that
 * couldn't be saved too, so the rest still go in). Throws ClientSiteError (403
 * not the user's client, 400 a tag that isn't this client's).
 */
export async function uploadClientDocuments(
  clientId: string,
  files: { name: string; bytes: Buffer }[],
  tag: ClientPlacement,
  user: SessionUser,
): Promise<UploadedFile[]> {
  const client = await getClient(clientId)
  await visibleDocuments(client._id, user, true)
  const { placement, site } = await resolvePlacement(client._id, tag, user, true)
  // Each file kept (its saved record) or refused, in the order sent.
  const answered: ({ name: string; saved: LeanDocument } | { name: string; reason: string })[] = []
  for (const { name, bytes } of files) {
    const checked = checkDocument(name, bytes)
    if ('reason' in checked) {
      answered.push({ name, reason: checked.reason })
      continue
    }
    const _id = new Types.ObjectId()
    const key = clientDocumentKey(client._id, _id, checked.type.ext)
    const now = new Date()
    try {
      await storage.putObject(key, bytes, checked.type.contentType)
    } catch (error) {
      console.error(`Could not upload ${key}:`, error)
      answered.push({ name, reason: SAVE_FAILED })
      continue
    }
    try {
      const created = await ClientDocumentModel.create({
        _id,
        client: client._id,
        placement,
        name,
        contentType: checked.type.contentType,
        size: bytes.length,
        // sha256 is a fingerprint: equal fingerprints mean equal files.
        sha256: createHash('sha256').update(bytes).digest('hex'),
        key,
        origin: 'upload',
        uploaded: { at: now, by: { id: user.id, name: user.name } },
        metadata: {
          source_type: 'client_document',
          ...siteMetadata(site),
          COPE_dimension: null,
          effective_date: now,
        },
      })
      answered.push({ name, saved: created.toObject() })
    } catch (error) {
      // Without this, a failed save would leave a file no record points at.
      console.error(`Could not record ${key}:`, error)
      await storage.deleteObject(key).catch(() => undefined)
      answered.push({ name, reason: SAVE_FAILED })
    }
  }
  // Named after every file is saved: a failure here must not touch a saved file.
  const dtos = await toDtos(answered.flatMap((a) => ('saved' in a ? [a.saved] : [])))
  return answered.map((a) =>
    'saved' in a
      ? { name: a.name, status: 'kept', document: dtos.find((d) => d.id === String(a.saved._id))! }
      : { name: a.name, status: 'refused', reason: a.reason },
  )
}

// What a file that failed to save says; the others still go in.
const SAVE_FAILED = "Couldn't save it. Try again."

/**
 * Moves a document to another tag and returns it. Throws
 * ClientDocumentNotFoundError, or ClientSiteError (403, or 400 for a site or
 * assessment that isn't the document's client's).
 */
export async function retagClientDocument(
  id: string,
  tag: ClientPlacement,
  user: SessionUser,
): Promise<ClientDocumentDto> {
  const document = await documentById(id, user, true)
  const { placement, site } = await resolvePlacement(document.client, tag, user, true)
  const updated = await ClientDocumentModel.findByIdAndUpdate(
    id,
    {
      // $set replaces the whole placement, so a site tag drops an old assessment.
      $set: {
        placement,
        ...Object.fromEntries(
          Object.entries(siteMetadata(site)).map(([k, v]) => [`metadata.${k}`, v]),
        ),
      },
    },
    { returnDocument: 'after' },
  ).lean()
  return (await toDtos([updated!]))[0]
}

// The document, when the user may see it: ClientDocumentNotFoundError for an
// unknown one or one outside their set (as if it did not exist), 403 when they
// have no assessment at its client.
async function documentById(id: string, user: SessionUser, forChange = false) {
  const found = isValidObjectId(id) ? await ClientDocumentModel.findById(id, 'client').lean() : null
  if (!found) throw new ClientDocumentNotFoundError()
  const visible = await visibleDocuments(found.client, user, forChange)
  const document = await ClientDocumentModel.findOne({ _id: id, ...visible }).lean()
  if (!document) throw new ClientDocumentNotFoundError()
  return document
}

/** Returns the document's original file: its name, type, size and a way to stream it. */
export async function getClientDocumentFile(id: string, user: SessionUser) {
  const document = await documentById(id, user)
  return {
    name: document.name,
    contentType: document.contentType,
    size: document.size,
    open: (range?: storage.ByteRange) => storage.getObjectStream(document.key, range),
  }
}

/**
 * Deletes the document's file, then its record (AC16); returns nothing. Throws
 * ClientDocumentFileError when S3 refuses, keeping the record.
 */
export async function deleteClientDocument(id: string, user: SessionUser): Promise<void> {
  const document = await documentById(id, user, true)
  // The file first: delete is permanent (decision 3), so without this a failed
  // S3 delete would report success while the original stayed. S3 deletes a
  // missing key without error, so a retry after a half-done delete works.
  try {
    await storage.deleteObject(document.key)
  } catch (error) {
    console.error(`Could not delete ${document.key}:`, error)
    throw new ClientDocumentFileError()
  }
  await ClientDocumentModel.deleteOne({ _id: document._id })
}
