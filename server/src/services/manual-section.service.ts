// A standard entered clause by clause (IN-18), for one with no PDF to upload:
// the draft document, then its clauses. A manual document never goes through
// the ingestion queue: each clause is indexed as it is saved
// (ingestion-service app/manual.py), and `manual_sections` holds its text.
import { randomUUID } from 'crypto'
import { isValidObjectId, type Types } from 'mongoose'
import { z } from 'zod'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import {
  MANUAL_IMAGE_KINDS,
  ManualSectionModel,
  type IManualSection,
  type ManualImageKind,
} from '../models/manual-section.model'
import {
  deleteManualSectionPassages,
  indexManualSection,
  IngestionUnavailableError,
  recogniseScreenshot,
  ScreenshotRejectedError,
} from './ingestion.service'
import {
  documentDetailsSchema,
  KnowledgeDocumentNotFoundError,
  KnowledgeDocumentWrongStateError,
  recordFields,
  RejectedFileError,
  reportCitations,
  toDtoOf,
} from './knowledge-document.service'
import * as storage from './storage.service'

// ─── The draft document ─────────────────────────────────────────────────────

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

// ─── Clauses ────────────────────────────────────────────────────────────────

type Actor = { id: string; name: string }
type Section = IManualSection & { _id: Types.ObjectId }

// A clause as the client gets it. `text` is the typed text only; each
// screenshot's corrected text is in `images`.
export type ManualSectionDto = {
  id: string
  seq: number
  order: number
  clause: string
  headings: string[]
  text: string
  images: { key: string; kind: ManualImageKind; text: string }[]
  indexed: boolean
  indexError: string | null
  checked: boolean
  copiedFrom: { documentId: string; clause: string } | null
  updatedBy: Actor
  updatedAt: Date
}

// Spaces collapsed, so " 8.6.1 " and "8.6.1" are one clause number.
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

// A clause as the admin saves it. Text may be empty when a screenshot carries
// the clause, but not both.
export const manualSectionSchema = z
  .object({
    clause: z
      .string()
      .transform(collapse)
      .pipe(
        z
          .string()
          .min(1, 'Enter the clause number.')
          .max(40, 'The clause number must be 40 characters or fewer.'),
      ),
    headings: z
      .array(z.string().transform(collapse).pipe(z.string().min(1).max(300)))
      .max(20, 'A heading trail has at most 20 headings.')
      .default([]),
    text: z.string().max(100_000, 'The clause text is too long.').default(''),
    order: z.number().int().min(0).optional(),
    images: z
      .array(
        z.object({
          key: z.string().min(1),
          kind: z.enum(MANUAL_IMAGE_KINDS),
          text: z.string().max(20_000).default(''),
        }),
      )
      .max(20, 'A clause has at most 20 screenshots.')
      .default([]),
  })
  .refine((s) => s.text.trim() || s.images.some((image) => image.text.trim()), {
    message: 'Enter the clause text, or add a screenshot.',
    path: ['text'],
  })
export type ManualSectionInput = z.infer<typeof manualSectionSchema>
// A change also carries the `updatedAt` it was loaded with, so a save over a newer one is refused.
export const manualSectionChangeSchema = manualSectionSchema.and(
  z.object({ updatedAt: z.iso.datetime({ message: 'Reload the clause and try again.' }) }),
)

// A clause number the document already has (409, shown on the clause field).
export class ClauseExistsError extends Error {
  constructor(readonly clause: string) {
    super(`Clause ${clause} already exists.`)
    this.name = 'ClauseExistsError'
  }
}

// A screenshot key that isn't one of this document's (400): only keys the
// screenshot route gave out may be saved.
export class ManualSectionInvalidError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
    this.name = 'ManualSectionInvalidError'
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000

function toSectionDto(s: Section): ManualSectionDto {
  return {
    id: String(s._id),
    seq: s.seq,
    order: s.order,
    clause: s.clause,
    headings: s.headings,
    text: s.text,
    images: s.images.map(({ key, kind, text }) => ({ key, kind, text })),
    indexed: s.indexed,
    indexError: s.indexError ?? null,
    checked: s.checked,
    copiedFrom: s.copiedFrom
      ? { documentId: String(s.copiedFrom.documentId), clause: s.copiedFrom.clause }
      : null,
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt,
  }
}

// The manual document, or 404 / 409: an uploaded document's passages stay read-only (IN-17).
async function manualDocument(id: string) {
  const doc = isValidObjectId(id) ? await KnowledgeDocumentModel.findById(id).lean() : null
  if (!doc) throw new KnowledgeDocumentNotFoundError()
  if (doc.entryMethod !== 'manual') {
    throw new KnowledgeDocumentWrongStateError(
      'Only a manually entered document has clauses to change.',
    )
  }
  return doc
}

// The manual document, when its clauses may change: not once withdrawn (replaced by its PDF).
async function editableDocument(id: string) {
  const doc = await manualDocument(id)
  if (doc.withdrawn) {
    throw new KnowledgeDocumentWrongStateError(
      'This document is withdrawn. Reinstate it to change its clauses.',
    )
  }
  return doc
}

async function findSection(documentId: string, sectionId: string): Promise<Section> {
  const section = isValidObjectId(sectionId)
    ? await ManualSectionModel.findOne({ _id: sectionId, documentId }).lean()
    : null
  if (!section) throw new KnowledgeDocumentNotFoundError()
  return section
}

function checkImages(documentId: string, input: ManualSectionInput) {
  const prefix = `knowledge/${documentId}/sections/`
  if (input.images.some((image) => !image.key.startsWith(prefix))) {
    throw new ManualSectionInvalidError(
      'images',
      'A screenshot must be one added to this document.',
    )
  }
}

async function refuseTakenClause(documentId: string, clause: string, except?: Types.ObjectId) {
  const taken = await ManualSectionModel.exists({
    documentId,
    clause,
    ...(except ? { _id: { $ne: except } } : {}),
  })
  if (taken) throw new ClauseExistsError(clause)
}

// Indexes the clause as saved, and records whether that worked: if ingestion is
// down the text is kept with `indexed: false`, and Re-embed tries again. The
// clause's old passages then stay searchable until it is indexed.
async function indexSection(section: Section): Promise<ManualSectionDto> {
  const text = [section.text, ...section.images.map((image) => image.text)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
  let update: object
  try {
    await indexManualSection(String(section.documentId), String(section._id), {
      seq: section.seq,
      order: section.order,
      clause: section.clause,
      headings: section.headings,
      text,
      images: section.images.map(({ key, kind }) => ({ key, kind })),
    })
    update = { $set: { indexed: true }, $unset: { indexError: 1 } }
  } catch (error) {
    if (!(error instanceof IngestionUnavailableError)) throw error
    update = { $set: { indexed: false, indexError: error.message } }
  }
  // Not a change by the admin: `updatedAt` stays the one their save set.
  const saved = await ManualSectionModel.findByIdAndUpdate(section._id, update, {
    new: true,
    timestamps: false,
  }).lean()
  return toSectionDto(saved!)
}

/** Returns a manual document's clauses in their order (IN-18). */
export async function listManualSections(documentId: string): Promise<ManualSectionDto[]> {
  await manualDocument(documentId)
  const found = await ManualSectionModel.find({ documentId }).sort({ order: 1, seq: 1 }).lean()
  return found.map(toSectionDto)
}

/**
 * Adds a clause, numbered once and for good (`seq`), last unless an `order` is
 * given, then indexes it. Refuses a clause number the document already has.
 */
export async function addManualSection(
  documentId: string,
  input: ManualSectionInput,
  by: Actor,
): Promise<ManualSectionDto> {
  const doc = await editableDocument(documentId)
  checkImages(documentId, input)
  await refuseTakenClause(documentId, input.clause)
  const numbered = await KnowledgeDocumentModel.findByIdAndUpdate(
    doc._id,
    { $inc: { manualSeq: 1 } },
    { new: true, projection: { manualSeq: 1 } },
  ).lean()
  const last = await ManualSectionModel.findOne({ documentId }, { order: 1 })
    .sort({ order: -1 })
    .lean()
  let created
  try {
    created = await ManualSectionModel.create({
      ...input,
      documentId,
      seq: numbered!.manualSeq,
      order: input.order ?? (last ? last.order + 10 : 10),
      checked: true,
      updatedBy: by,
    })
  } catch (error) {
    if (isDuplicateKey(error)) throw new ClauseExistsError(input.clause)
    throw error
  }
  return indexSection(created.toObject())
}

/**
 * Saves a change to a clause and indexes it. Refuses (409) when someone saved it
 * since `updatedAt`, or when its new number is another clause's. Saving marks a
 * copied clause checked for this edition.
 */
export async function changeManualSection(
  documentId: string,
  sectionId: string,
  input: ManualSectionInput & { updatedAt: string },
  by: Actor,
): Promise<ManualSectionDto> {
  await editableDocument(documentId)
  const section = await findSection(documentId, sectionId)
  checkImages(documentId, input)
  await refuseTakenClause(documentId, input.clause, section._id)
  const { updatedAt, ...fields } = input
  let saved
  try {
    // Matched on `updatedAt` too, so two saves at once can't both pass the check.
    saved = await ManualSectionModel.findOneAndUpdate(
      { _id: section._id, updatedAt: new Date(updatedAt) },
      { $set: { ...fields, order: fields.order ?? section.order, checked: true, updatedBy: by } },
      { new: true },
    ).lean()
  } catch (error) {
    if (isDuplicateKey(error)) throw new ClauseExistsError(input.clause)
    throw error
  }
  if (!saved) {
    throw new KnowledgeDocumentWrongStateError(
      'Someone else saved this clause since you opened it. Reload it to see their change.',
    )
  }
  return indexSection(saved)
}

/** Indexes a clause again as saved: after a failed save, or to refresh its passages. */
export async function reembedManualSection(
  documentId: string,
  sectionId: string,
): Promise<ManualSectionDto> {
  await editableDocument(documentId)
  return indexSection(await findSection(documentId, sectionId))
}

/**
 * Deletes a clause: its passages first (if that fails, nothing changes; a 503),
 * then the clause, then its screenshots. Refused (409) while a report cites any
 * of its passages, as IN-12 refuses deleting a cited document.
 */
export async function deleteManualSection(documentId: string, sectionId: string): Promise<void> {
  await editableDocument(documentId)
  const section = await findSection(documentId, sectionId)
  const own = `C:${documentId}:${section.seq}`
  const cited = (await reportCitations()).some((c) => c === own || c.startsWith(`${own}:`))
  if (cited) {
    throw new KnowledgeDocumentWrongStateError(
      "A report cites this clause, so it can't be deleted. You can still change its text.",
    )
  }
  await deleteManualSectionPassages(documentId, sectionId)
  await ManualSectionModel.deleteOne({ _id: section._id })
  // Best effort: an orphaned screenshot costs storage, never correctness.
  await Promise.all(
    section.images.map((image) => storage.deleteObject(image.key).catch(() => undefined)),
  )
}

// ─── Screenshots ────────────────────────────────────────────────────────────

// The image types a screenshot may be, by their first bytes (the Content-Type
// is ignored, as for uploads). Ingestion reads each as PNG.
const SCREENSHOT_TYPES = [
  {
    ext: 'png',
    type: 'image/png',
    is: (b: Buffer) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  },
  {
    ext: 'jpg',
    type: 'image/jpeg',
    is: (b: Buffer) => b.subarray(0, 3).toString('hex') === 'ffd8ff',
  },
  {
    ext: 'webp',
    type: 'image/webp',
    is: (b: Buffer) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
]
// A stored screenshot's file name: the id given at upload and its type.
const SCREENSHOT_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/

export const screenshotQuerySchema = z.object({
  kind: z.enum(MANUAL_IMAGE_KINDS, 'Say whether the screenshot is a table, formula or picture.'),
  // The clause's heading trail, which helps a picture's description.
  context: z.string().max(2000).default(''),
})

export type ScreenshotDto = {
  key: string
  kind: ManualImageKind
  // What OCR read, for the admin to correct before saving the clause; '' if it read nothing.
  text: string
  // Why there is no text to correct, or null.
  readError: string | null
}

/**
 * Reads a screenshot with OCR and stores it under the document
 * (`knowledge/<id>/sections/<uuid>.<ext>`), returning its key and the text to
 * correct. The clause holds it once saved. Refuses (RejectedFileError 415) a
 * file that isn't a PNG, JPG or WebP, and (422) one ingestion can't open.
 * When OCR reads nothing, the image is still kept and the text is left to type.
 */
export async function addScreenshot(
  documentId: string,
  image: Buffer,
  { kind, context }: z.infer<typeof screenshotQuerySchema>,
): Promise<ScreenshotDto> {
  await editableDocument(documentId)
  const type = SCREENSHOT_TYPES.find((t) => t.is(image))
  if (!type) throw new RejectedFileError(415, 'Add a PNG, JPG or WebP image.')
  let text: string | null
  try {
    text = await recogniseScreenshot(documentId, image, kind, context)
  } catch (error) {
    if (error instanceof ScreenshotRejectedError) throw new RejectedFileError(422, error.message)
    throw error
  }
  const key = `knowledge/${documentId}/sections/${randomUUID()}.${type.ext}`
  await storage.putObject(key, image, type.type)
  return {
    key,
    kind,
    text: text ?? '',
    readError: text
      ? null
      : "The image couldn't be read automatically. Type its text in, or try again.",
  }
}

/**
 * Returns a screenshot a clause of this document holds, to stream (IN-18). Anything
 * else, including one uploaded but never saved, is not found.
 */
export async function getScreenshot(documentId: string, name: string) {
  await manualDocument(documentId)
  const found = SCREENSHOT_NAME.exec(name)
  const key = `knowledge/${documentId}/sections/${name}`
  if (!found || !(await ManualSectionModel.exists({ documentId, 'images.key': key }))) {
    throw new KnowledgeDocumentNotFoundError()
  }
  return {
    contentType: SCREENSHOT_TYPES.find((t) => t.ext === found[1])!.type,
    open: () => storage.getObjectStream(key),
  }
}
