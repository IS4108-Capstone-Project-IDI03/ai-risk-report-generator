// Knowledge documents on the gateway (IN-01): check an upload, store it, record
// it and queue its ingestion; list them; stream an original back.
// Called by routes/knowledge-document.routes.ts.
import { createHash } from 'crypto'
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import {
  KnowledgeDocumentModel,
  type IKnowledgeDocument,
  type SourceType,
} from '../models/knowledge-document.model'
import { enqueueIngestion } from './ingestion-queue.service'
import { IngestionUnavailableError, whyPdfCannotOpen } from './ingestion.service'
import * as storage from './storage.service'

const text = (label: string, max: number) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)

// Worked out on each check, so a long-running gateway rolls over at New Year.
const nextYear = () => new Date().getFullYear() + 1

const country = (allowAll: boolean) =>
  z
    .string('Country is required.')
    .regex(
      allowAll ? /^([A-Z]{2}|all)$/ : /^[A-Z]{2}$/,
      'Country must be a two-letter code, e.g. SG.',
    )

// The details the admin enters for each file (IN-01 AC1), as Zod validation
// rules. Which details are asked depends on the source type: a standard has an
// edition and may apply in all countries; a past Marsh report has neither, but
// is about one facility type. They arrive in the query string because the
// request body is the PDF itself. A broken rule becomes a 400 naming the field.
const common = {
  fileName: text('File name', 255),
  title: text('Title', 200),
  effectiveDate: z.iso.date('The date must be a valid date (YYYY-MM-DD).'),
}
export const documentDetailsSchema = z.discriminatedUnion(
  'sourceType',
  [
    z.object({
      ...common,
      sourceType: z.enum(['fm_standard', 'nfpa_standard']),
      // A year, so IN-02 can compare editions reliably. Up to next year,
      // since an edition can be published ahead of the year it is named for.
      edition: z
        .string('Edition is required.')
        .refine((value) => /^\d{4}$/.test(value) && +value >= 1900 && +value <= nextYear(), {
          error: () => `Edition must be a year from 1900 to ${nextYear()}.`,
        }),
      jurisdiction: country(true),
      facilityType: z
        .string()
        .trim()
        .max(100, 'Facility type must be 100 characters or fewer.')
        .optional()
        .transform((value) => value || 'all'),
    }),
    z.object({
      ...common,
      sourceType: z.literal('marsh_report'),
      jurisdiction: country(false),
      facilityType: text('Facility type', 100),
    }),
  ],
  'Choose a source type: FM standard, NFPA standard or Marsh report.',
)
export type DocumentDetails = z.infer<typeof documentDetailsSchema>

// Who publishes each source type; the admin never types it.
const ISSUING_BODY: Record<SourceType, string> = {
  fm_standard: 'FM Global',
  nfpa_standard: 'NFPA',
  marsh_report: 'Marsh',
}

export type KnowledgeDocumentDto = {
  id: string
  title: string
  issuingBody: string
  edition: string | null
  fileName: string
  sourceType: string
  jurisdiction: string
  facilityType: string
  effectiveDate: string
  size: number
  sha256: string
  status: IKnowledgeDocument['status']
  error: string | null
  uploadedAt: Date
  fileUrl: string
}

// Turns a database row into the shape the browser's api.ts expects.
function toDto(d: IKnowledgeDocument & { _id: Types.ObjectId }): KnowledgeDocumentDto {
  return {
    id: String(d._id),
    title: d.title,
    issuingBody: d.issuingBody,
    edition: d.edition ?? null,
    fileName: d.fileName,
    sourceType: d.metadata.source_type,
    jurisdiction: d.metadata.jurisdiction,
    facilityType: d.metadata.facility_type,
    effectiveDate: d.metadata.effective_date.toISOString().slice(0, 10),
    size: d.file.size,
    sha256: d.file.sha256,
    status: d.status,
    error: d.error ?? null,
    uploadedAt: d.createdAt,
    fileUrl: `/api/knowledge-documents/${d._id}/file`,
  }
}

// A file IN-01 AC5 turns away. `status` is the HTTP status to answer with.
export class RejectedFileError extends Error {
  constructor(
    readonly status: 415 | 422,
    reason: string,
  ) {
    super(reason)
    this.name = 'RejectedFileError'
  }
}

// Every PDF starts with this marker; the Content-Type alone is only a claim.
const PDF_MARKER = Buffer.from('%PDF-')

// Stores the original PDF in S3, records it with its details and queues its
// ingestion (AC1, AC2), in steps a–e. Throws RejectedFileError before storing
// anything if the file is not a PDF or cannot be opened (AC5), so a rejected
// file leaves no trace.
export async function uploadKnowledgeDocument(
  pdf: Buffer,
  contentType: string,
  details: DocumentDetails,
): Promise<KnowledgeDocumentDto> {
  // a. Is it really a PDF? Cheap, so it runs first.
  if (
    contentType.split(';')[0].trim() !== 'application/pdf' ||
    !pdf.subarray(0, 5).equals(PDF_MARKER)
  ) {
    throw new RejectedFileError(415, 'Only PDF files can be uploaded.')
  }
  // b. Does it open? Asks the ingestion service (see ingestion.service.ts).
  const cannotOpen = await whyPdfCannotOpen(pdf)
  if (cannotOpen) throw new RejectedFileError(422, cannotOpen)

  // c. Store the unaltered original in S3 (AC4).
  const id = new Types.ObjectId()
  const key = `knowledge/${id}.pdf`
  await storage.putObject(key, pdf, 'application/pdf')

  // d. Record it in MongoDB as `queued`. sha256 is a fingerprint that proves a
  // copy retrieved later matches the upload.
  let document
  try {
    document = await KnowledgeDocumentModel.create({
      _id: id,
      title: details.title,
      issuingBody: ISSUING_BODY[details.sourceType],
      edition: 'edition' in details ? details.edition : undefined,
      fileName: details.fileName,
      file: {
        key,
        contentType: 'application/pdf',
        size: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'),
      },
      status: 'queued',
      metadata: {
        source_type: details.sourceType,
        jurisdiction: details.jurisdiction,
        facility_type: details.facilityType,
        COPE_dimension: 'all',
        effective_date: new Date(details.effectiveDate),
      },
    })
  } catch (error) {
    // No transactions on a standalone mongod, so undo the upload by hand.
    await storage.deleteObject(key).catch(() => undefined)
    throw error
  }
  // e. Queue its ingestion; the worker picks it up from there.
  try {
    await enqueueIngestion(String(id))
  } catch (error) {
    // A stored document that is never queued would sit at "queued" forever.
    console.error('Queueing ingestion failed:', error)
    await KnowledgeDocumentModel.deleteOne({ _id: id }).catch(() => undefined)
    await storage.deleteObject(key).catch(() => undefined)
    throw new IngestionUnavailableError(
      'Ingestion could not be queued. Try uploading again shortly.',
    )
  }
  return toDto(document.toObject())
}

export class KnowledgeDocumentNotFoundError extends Error {
  constructor() {
    super('The document was not found.')
    this.name = 'KnowledgeDocumentNotFoundError'
  }
}

// The unaltered original from S3 (AC4).
export async function getKnowledgeDocumentFile(id: string) {
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  const document = await KnowledgeDocumentModel.findById(id, 'file fileName').lean()
  if (!document) throw new KnowledgeDocumentNotFoundError()
  return {
    fileName: document.fileName,
    size: document.file.size,
    stream: await storage.getObjectStream(document.file.key),
  }
}

const HOUR = 60 * 60 * 1000

/**
 * Returns the recent uploads, newest first: every document still queued or
 * processing, plus those that finished recently. A success needs no follow-up,
 * so it shows for 24 hours; a failure needs someone to act, so it shows for 7
 * days. Older documents stay stored; they are just not listed here (the full
 * knowledge base view is KB-01).
 */
export async function listKnowledgeDocuments(): Promise<KnowledgeDocumentDto[]> {
  const since = (hours: number) => new Date(Date.now() - hours * HOUR)
  const documents = await KnowledgeDocumentModel.find({
    $or: [
      { status: { $in: ['queued', 'processing'] } },
      { status: 'complete', finishedAt: { $gte: since(24) } },
      { status: 'failed', finishedAt: { $gte: since(7 * 24) } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean()
  return documents.map(toDto)
}
