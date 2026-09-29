import { createHash } from 'crypto'
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import {
  KnowledgeDocumentModel,
  SOURCE_TYPES,
  type IKnowledgeDocument,
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

// The details the admin enters for each file (IN-01 AC1). They arrive in the
// query string because the request body is the PDF itself.
export const documentDetailsSchema = z.object({
  fileName: text('File name', 255),
  title: text('Title', 200),
  issuingBody: text('Issuing body', 100),
  edition: text('Edition', 100),
  effectiveDate: z.iso.date('Effective date must be a valid date (YYYY-MM-DD).'),
  sourceType: z.enum(
    SOURCE_TYPES,
    'Choose a source type: FM standard, NFPA standard or Marsh report.',
  ),
  jurisdiction: z
    .string('Country is required.')
    .regex(/^[A-Z]{2}$/, 'Country must be a two-letter code, e.g. SG.'),
  facilityType: z
    .string()
    .trim()
    .max(100, 'Facility type must be 100 characters or fewer.')
    .optional()
    .transform((value) => value || 'all'),
})
export type DocumentDetails = z.infer<typeof documentDetailsSchema>

export type KnowledgeDocumentDto = {
  id: string
  title: string
  issuingBody: string
  edition: string
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

function toDto(d: IKnowledgeDocument & { _id: Types.ObjectId }): KnowledgeDocumentDto {
  return {
    id: String(d._id),
    title: d.title,
    issuingBody: d.issuingBody,
    edition: d.edition,
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
// ingestion (AC1, AC2). Throws RejectedFileError before storing anything if
// the file is not a PDF or cannot be opened (AC5).
export async function uploadKnowledgeDocument(
  pdf: Buffer,
  contentType: string,
  details: DocumentDetails,
): Promise<KnowledgeDocumentDto> {
  if (
    contentType.split(';')[0].trim() !== 'application/pdf' ||
    !pdf.subarray(0, 5).equals(PDF_MARKER)
  ) {
    throw new RejectedFileError(415, 'Only PDF files can be uploaded.')
  }
  const cannotOpen = await whyPdfCannotOpen(pdf)
  if (cannotOpen) throw new RejectedFileError(422, cannotOpen)

  const id = new Types.ObjectId()
  const key = `knowledge/${id}.pdf`
  await storage.putObject(key, pdf, 'application/pdf')

  let document
  try {
    document = await KnowledgeDocumentModel.create({
      _id: id,
      title: details.title,
      issuingBody: details.issuingBody,
      edition: details.edition,
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

// Newest first, so the admin sees their latest uploads at the top.
export async function listKnowledgeDocuments(): Promise<KnowledgeDocumentDto[]> {
  const documents = await KnowledgeDocumentModel.find().sort({ createdAt: -1 }).lean()
  return documents.map(toDto)
}
