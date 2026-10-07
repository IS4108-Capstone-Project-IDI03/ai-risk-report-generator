// Knowledge documents on the gateway (IN-01): check an upload, store it, record
// it and queue its ingestion; list them; stream an original back. KB-01 adds
// the knowledge base list and correcting a document's details.
// Called by routes/knowledge-document.routes.ts.
import { createHash } from 'crypto'
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import {
  DETAIL_NAMES,
  KnowledgeDocumentModel,
  SOURCE_TYPES,
  type DetailName,
  type IKnowledgeDocument,
  type ILabelledDetail,
  type SourceType,
} from '../models/knowledge-document.model'
import type { IIngestionJob, IngestionStage } from '../models/ingestion-job.model'
import { getJobProgressBatch } from './ingestion-job.service'
import { enqueueIngestion, requeueIngestion } from './ingestion-queue.service'
import {
  IngestionUnavailableError,
  labelDocument,
  relabelPassages,
  whyPdfCannotOpen,
  type LabelAnswer,
} from './ingestion.service'
import * as storage from './storage.service'

const text = (label: string, max: number) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)

// Worked out on each check, so a long-running gateway rolls over at New Year.
const nextYear = () => new Date().getFullYear() + 1

// A year, so IN-02 can compare editions reliably. Up to next year, since an
// edition can be published ahead of the year it is named for.
const edition = () =>
  z
    .string('Edition is required.')
    .refine((value) => /^\d{4}$/.test(value) && +value >= 1900 && +value <= nextYear(), {
      error: () => `Edition must be a year from 1900 to ${nextYear()}.`,
    })

const country = (allowAll: boolean) =>
  z
    .string('Country is required.')
    .regex(
      allowAll ? /^([A-Z]{2}|all)$/ : /^[A-Z]{2}$/,
      'Country must be a two-letter code, e.g. SG.',
    )

// The facility types a document may be labelled with (KB-01 AC7). Must match
// FACILITY_TYPES in client/src/features/assessments/demo-data.ts, which the
// forms offer.
const FACILITY_TYPES = [
  'Distribution warehouse',
  'Cold store',
  'Chemical plant',
  'Paper mill',
  'Port terminal',
  'Data centre',
  'Office',
  'Shopping mall',
  'Mixed-use development',
]
const onTheList = (allowed: string[]) =>
  [(value: string) => allowed.includes(value), 'Choose a facility type from the list.'] as const

// The details an admin corrects (KB-01) or auto-labelling reads (IN-05), as
// Zod validation rules. Which details are asked depends on the
// source type: a standard has an edition and may apply in all countries; a past
// Marsh report has neither, but is about one facility type. A broken rule
// becomes a 400 naming the field.
const common = {
  title: text('Title', 200),
  effectiveDate: z.iso.date('The date must be a valid date (YYYY-MM-DD).'),
}
export const documentDetailsSchema = z.discriminatedUnion(
  'sourceType',
  [
    z.object({
      ...common,
      sourceType: z.enum(['fm_standard', 'nfpa_standard']),
      edition: edition(),
      jurisdiction: country(true),
      facilityType: z
        .string()
        .trim()
        .optional()
        .transform((value) => value || 'all')
        .refine(...onTheList([...FACILITY_TYPES, 'all'])),
    }),
    z.object({
      ...common,
      sourceType: z.literal('marsh_report'),
      jurisdiction: country(false),
      facilityType: text('Facility type', 100).refine(...onTheList(FACILITY_TYPES)),
    }),
  ],
  'Choose a source type: FM standard, NFPA standard or Marsh report.',
)
export type DocumentDetails = z.infer<typeof documentDetailsSchema>

// An upload asks for nothing but the file's name (IN-05 replaces IN-01 AC1).
// It arrives in the query string because the request body is the PDF itself.
export const uploadQuerySchema = z.object({ fileName: text('File name', 255) })

// Who publishes each source type; the admin never types it.
const ISSUING_BODY: Record<SourceType, string> = {
  fm_standard: 'FM Global',
  nfpa_standard: 'NFPA',
  marsh_report: 'Marsh',
}

// Ingestion progress folded into the DTO while a document is `processing` (E2).
// Elapsed times are computed on read so they are never stale.
type ProgressDto = {
  currentStage: IngestionStage
  // The page being chunked and the document's page total (E2b). The chunk
  // count has no knowable total up front, so progress is tracked by page.
  // Both null until chunking reaches a page with provenance.
  pageCurrent: number | null
  pageTotal: number | null
  elapsedMs: number
  currentStageElapsedMs: number
  stageLog: { stage: string; startedAt: string; durationMs: number }[]
}

// The detail names as the browser spells them (camelCase of DETAIL_NAMES).
const DETAIL_DTO_NAME = {
  source_type: 'sourceType',
  title: 'title',
  edition: 'edition',
  effective_date: 'effectiveDate',
  jurisdiction: 'jurisdiction',
  facility_type: 'facilityType',
} as const
export type DetailDtoName = (typeof DETAIL_DTO_NAME)[DetailName]

const isoDay = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null

export type KnowledgeDocumentDto = {
  id: string
  title: string
  issuingBody: string | null
  edition: string | null
  fileName: string
  // A detail labelling could not confirm is null (IN-05).
  sourceType: string | null
  jurisdiction: string | null
  facilityType: string | null
  effectiveDate: string | null
  // The details still Unconfirmed; non-empty = "needs review" (IN-05).
  unconfirmed: DetailDtoName[]
  size: number
  sha256: string
  status: IKnowledgeDocument['status']
  error: string | null
  uploadedAt: Date
  fileUrl: string
  // Who withdrew the document and when (KB-01 AC14); null while it is active.
  withdrawn: { at: Date; by: { id: string; name: string } } | null
  // Earlier versions of the details, newest first (KB-01 AC9).
  history: {
    sourceType: string | null
    title: string
    edition: string | null
    effectiveDate: string | null
    jurisdiction: string | null
    facilityType: string | null
    replacedAt: Date
    replacedBy: { id: string; name: string }
  }[]
  // Live ingestion progress; present only while `status` is `processing` and a
  // matching ingestion_jobs row exists (E2).
  progress?: ProgressDto
}

// Builds the progress field from an ingestion job, computing elapsed times on
// read and serialising stageLog dates to ISO strings.
function toProgressDto(job: IIngestionJob): ProgressDto {
  const now = Date.now()
  return {
    currentStage: job.currentStage,
    pageCurrent: job.pageCurrent,
    pageTotal: job.pageTotal,
    elapsedMs: now - job.startedAt.getTime(),
    currentStageElapsedMs: now - job.currentStageStartedAt.getTime(),
    stageLog: job.stageLog.map((entry) => ({
      stage: entry.stage,
      startedAt: entry.startedAt.toISOString(),
      durationMs: entry.durationMs,
    })),
  }
}

// Turns a database row into the shape the browser's api.ts expects. When a
// processing document has an ingestion job, its progress is folded in (E2).
function toDto(
  d: IKnowledgeDocument & { _id: Types.ObjectId },
  job?: IIngestionJob,
): KnowledgeDocumentDto {
  return {
    id: String(d._id),
    title: d.title,
    issuingBody: d.issuingBody ?? null,
    edition: d.edition ?? null,
    fileName: d.fileName,
    sourceType: d.metadata.source_type,
    jurisdiction: d.metadata.jurisdiction,
    facilityType: d.metadata.facility_type,
    effectiveDate: isoDay(d.metadata.effective_date),
    // Records from before IN-05 have no field.
    unconfirmed: (d.unconfirmed ?? []).map((name) => DETAIL_DTO_NAME[name]),
    size: d.file.size,
    sha256: d.file.sha256,
    status: d.status,
    error: d.error ?? null,
    uploadedAt: d.createdAt,
    fileUrl: `/api/knowledge-documents/${d._id}/file`,
    withdrawn: d.withdrawn ? { at: d.withdrawn.at, by: d.withdrawn.by } : null,
    // Records from before history existed have no field; `?? []` gives them none.
    history: [...(d.history ?? [])].reverse().map((v) => ({
      sourceType: v.metadata.source_type,
      title: v.title,
      edition: v.edition ?? null,
      effectiveDate: isoDay(v.metadata.effective_date),
      jurisdiction: v.metadata.jurisdiction,
      facilityType: v.metadata.facility_type,
      replacedAt: v.replacedAt,
      replacedBy: v.replacedBy,
    })),
    // Only processing documents carry progress; the caller passes a job only
    // for those (see listKnowledgeDocuments).
    ...(job && d.status === 'processing' ? { progress: toProgressDto(job) } : {}),
  }
}

// The labelling record after a correction: every detail now holds the saved
// value with `source: 'admin'`. The auto label's confidence, evidence and model
// are kept as history of what the model saw (absent if labelling had failed).
function adminLabelling(
  old: IKnowledgeDocument['labelling'],
  next: ReturnType<typeof recordFields>,
): NonNullable<IKnowledgeDocument['labelling']> {
  const saved = {
    source_type: next.metadata.source_type,
    title: next.title,
    edition: next.edition ?? null,
    effective_date: isoDay(next.metadata.effective_date),
    jurisdiction: next.metadata.jurisdiction,
    facility_type: next.metadata.facility_type,
  }
  return {
    labelledAt: old?.labelledAt ?? new Date(),
    details: Object.fromEntries(
      DETAIL_NAMES.map((name) => [
        name,
        { ...old?.details[name], value: saved[name], source: 'admin' },
      ]),
    ),
  }
}

// The record fields a document's details decide. `edition` is undefined for a
// past report, which removes it when a standard is corrected into a report.
function recordFields(details: DocumentDetails) {
  return {
    title: details.title,
    issuingBody: ISSUING_BODY[details.sourceType],
    edition: 'edition' in details ? details.edition : undefined,
    metadata: {
      source_type: details.sourceType,
      jurisdiction: details.jurisdiction,
      facility_type: details.facilityType,
      COPE_dimension: 'all' as const,
      effective_date: new Date(details.effectiveDate),
    },
  }
}

// Whether a correction changes any detail the record holds. Dates compare by
// time value, since two Date objects are never `===`. Old details may be
// null (Unconfirmed), which always differs from a saved value.
function differs(old: IKnowledgeDocument, next: ReturnType<typeof recordFields>) {
  const a = old.metadata
  const b = next.metadata
  return (
    old.title !== next.title ||
    old.issuingBody !== next.issuingBody ||
    old.edition !== next.edition ||
    a.source_type !== b.source_type ||
    a.jurisdiction !== b.jurisdiction ||
    a.facility_type !== b.facility_type ||
    a.COPE_dimension !== b.COPE_dimension ||
    a.effective_date?.getTime() !== b.effective_date.getTime()
  )
}

/**
 * Returns the labels every passage of the document carries, so search can
 * filter on them: its metadata, the date as YYYY-MM-DD, and `status`, which
 * search uses to skip passages that are not `active`: `withdrawn` (KB-01) or
 * `needs_review` (IN-05, some detail Unconfirmed). Null details are left out
 * (Chroma can't store null, and no filter should match them), and
 * COPE_dimension is never sent, so a relabel can't overwrite per-passage COPE.
 * Must match `labels()` in microservices/ingestion-service/app/worker.py,
 * which labels passages at ingest.
 */
function labels({
  metadata,
  withdrawn,
  unconfirmed,
}: Pick<IKnowledgeDocument, 'metadata' | 'withdrawn' | 'unconfirmed'>) {
  const details = {
    source_type: metadata.source_type,
    jurisdiction: metadata.jurisdiction,
    facility_type: metadata.facility_type,
    effective_date: isoDay(metadata.effective_date),
  }
  return {
    ...Object.fromEntries(Object.entries(details).filter(([, value]) => value != null)),
    status: withdrawn ? 'withdrawn' : unconfirmed?.length ? 'needs_review' : 'active',
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

// Today's date in Singapore (UTC+8, no daylight saving) as YYYY-MM-DD: the
// upload date a document is effective from when /label gives no date (IN-05).
// Must match microservices/ingestion-service/app/labelling/__init__.py.
const uploadDay = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)

// Turns the /label answer (or null when labelling failed) into the record
// fields: the six details, `unconfirmed` and `labelling`. Each value is checked
// again here, so a model slip (e.g. a report for "all" facilities) becomes
// Unconfirmed (null) instead of reaching the database. The title falls back to
// the file name, but stays Unconfirmed.
function labelledRecord(answer: LabelAnswer | null, fileName: string) {
  const raw = (name: DetailName) => answer?.details[name]?.value
  const valid = <T>(schema: z.ZodType<T>, name: DetailName): T | null => {
    const parsed = schema.safeParse(raw(name))
    return parsed.success ? parsed.data : null
  }
  const sourceType = SOURCE_TYPES.find((type) => type === raw('source_type')) ?? null
  // Only a standard may apply to "all"; an unknown source type can't tell.
  const allowAll = sourceType !== null && sourceType !== 'marsh_report'
  const values = {
    source_type: sourceType,
    title: valid(text('Title', 200), 'title'),
    edition: sourceType === 'marsh_report' ? null : valid(edition(), 'edition'),
    // Never Unconfirmed: without a date, every upload would need review.
    effective_date: valid(common.effectiveDate, 'effective_date') ?? uploadDay(),
    jurisdiction: valid(country(allowAll), 'jurisdiction'),
    facility_type: valid(
      z.string().refine(...onTheList(allowAll ? [...FACILITY_TYPES, 'all'] : FACILITY_TYPES)),
      'facility_type',
    ),
  }
  // A report has no edition, so it is never "missing".
  const unconfirmed = DETAIL_NAMES.filter(
    (name) => values[name] === null && !(name === 'edition' && sourceType === 'marsh_report'),
  )
  const details = Object.fromEntries(
    DETAIL_NAMES.flatMap((name) => {
      const found = answer?.details[name]
      if (!found) return []
      const kept: ILabelledDetail = {
        value: values[name],
        confidence: found.confidence,
        evidence: found.evidence,
        model: found.model,
        source: 'auto',
      }
      return [[name, kept]]
    }),
  )
  return {
    title: values.title ?? fileName,
    issuingBody: sourceType ? ISSUING_BODY[sourceType] : null,
    edition: values.edition ?? undefined,
    metadata: {
      source_type: sourceType,
      jurisdiction: values.jurisdiction,
      facility_type: values.facility_type,
      COPE_dimension: 'all' as const,
      effective_date: values.effective_date ? new Date(values.effective_date) : null,
    },
    unconfirmed,
    labelling: answer ? { labelledAt: new Date(), details } : undefined,
  }
}

// Stores the original PDF in S3, records it with the details auto-labelling
// reads from it and queues its ingestion (IN-01, IN-05), in steps a–f. Throws
// RejectedFileError before labelling or storing anything if the file is not a
// PDF or cannot be opened (IN-01 AC5), so a rejected file leaves no trace.
export async function uploadKnowledgeDocument(
  pdf: Buffer,
  contentType: string,
  fileName: string,
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

  // c. Read its details. Never fails the upload: no answer means every
  // detail is Unconfirmed and an admin fills them in.
  const record = labelledRecord(await labelDocument(pdf), fileName)

  // d. Store the unaltered original in S3 (IN-01 AC4).
  const id = new Types.ObjectId()
  const key = `knowledge/${id}.pdf`
  await storage.putObject(key, pdf, 'application/pdf')

  // e. Record it in MongoDB as `queued`. sha256 is a fingerprint that proves a
  // copy retrieved later matches the upload.
  let document
  try {
    document = await KnowledgeDocumentModel.create({
      _id: id,
      ...record,
      fileName,
      file: {
        key,
        contentType: 'application/pdf',
        size: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'),
      },
      status: 'queued',
    })
  } catch (error) {
    // No transactions on a standalone mongod, so undo the upload by hand.
    await storage.deleteObject(key).catch(() => undefined)
    throw error
  }
  // f. Queue its ingestion; the worker picks it up from there.
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

  // Enrich processing documents with their ingestion progress (E2) in a single
  // batch read. Documents without a job (worker not started) keep no progress.
  const processingIds = documents.filter((d) => d.status === 'processing').map((d) => String(d._id))
  const jobs = await getJobProgressBatch(processingIds)

  return documents.map((d) => toDto(d, jobs.get(String(d._id))))
}

/**
 * Returns every ingested document (ingestion complete), active or withdrawn,
 * sorted by title A–Z (KB-01). The collation sorts as a reader would:
 * "apple" beside "Apple", not after every capital letter.
 */
export async function listIngestedDocuments(): Promise<KnowledgeDocumentDto[]> {
  const documents = await KnowledgeDocumentModel.find({ status: 'complete' })
    .collation({ locale: 'en' })
    .sort({ title: 1 })
    .lean()
  // Complete documents carry no progress, so no job is passed to toDto.
  return documents.map((d) => toDto(d))
}

// The review workspace resolves only the documents cited by a draft.
export async function findKnowledgeDocuments(ids: string[]): Promise<KnowledgeDocumentDto[]> {
  const valid = [...new Set(ids)].filter((id) => isValidObjectId(id))
  if (!valid.length) return []
  const documents = await KnowledgeDocumentModel.find({ _id: { $in: valid } }).lean()
  return documents.map((d) => toDto(d))
}

// The document isn't in the state the change needs (a 409). KB-01: only an
// active document can be corrected; one still ingesting would have some
// passages indexed under the old labels. KB-01: withdraw needs an active
// document, reinstate a withdrawn one.
export class KnowledgeDocumentWrongStateError extends Error {
  constructor(message = 'Only a document that has finished ingesting can be corrected.') {
    super(message)
    this.name = 'KnowledgeDocumentWrongStateError'
  }
}

/**
 * Returns the document with its corrected details (KB-01 AC6), in steps a–c.
 * Every detail can change, including the source type. The details it
 * replaces are kept as a previous version (AC9) when anything changed. Throws
 * KnowledgeDocumentNotFoundError, KnowledgeDocumentWrongStateError (also for a
 * withdrawn document, KB-01 AC15), or IngestionUnavailableError when search
 * could not be updated, in which case the old details are kept.
 */
export async function correctKnowledgeDocument(
  id: string,
  details: DocumentDetails,
  by: { id: string; name: string },
): Promise<KnowledgeDocumentDto> {
  // a. Find it, and check it is active.
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  const document = await KnowledgeDocumentModel.findById(id)
  if (!document) throw new KnowledgeDocumentNotFoundError()
  if (document.status !== 'complete') throw new KnowledgeDocumentWrongStateError()
  if (document.withdrawn) {
    throw new KnowledgeDocumentWrongStateError(
      "A withdrawn document can't be edited. Reinstate it first.",
    )
  }

  // b. Save the new details, keeping the old ones in case step c fails. If
  // anything changed, the old details also join the history (AC9).
  const old = document.toObject()
  const { title, issuingBody, edition, metadata, history, unconfirmed, labelling } = old
  const next = recordFields(details)
  document.set({ ...next, unconfirmed: [], labelling: adminLabelling(labelling, next) })
  if (differs(old, next)) {
    document.history.push({
      title,
      issuingBody,
      edition,
      metadata,
      replacedAt: new Date(),
      replacedBy: by,
    })
  }
  await document.save()

  // c. Put the new labels on its passages in Chroma. If that fails, write the
  // old details and history back: without this, MongoDB would show the
  // correction while search still used the old labels.
  try {
    await relabelPassages(
      id,
      labels(document.toObject()),
      'Search could not be updated, so the correction was not saved. Try again shortly.',
    )
  } catch (error) {
    document.set({ title, issuingBody, edition, metadata, history, unconfirmed, labelling })
    await document.save()
    throw error
  }
  return toDto(document.toObject())
}

// Withdraws or reinstates a document (KB-01), in steps a–c. `by` is who
// withdrew it; reinstating records no one.
async function setWithdrawn(
  id: string,
  by: { id: string; name: string } | undefined,
): Promise<KnowledgeDocumentDto> {
  // What the admin reads if the change is refused or fails. Shown as-is by
  // client/src/features/knowledge-base/components/StatusChangeDialog.tsx.
  const wrongState = by
    ? 'This document is no longer active. Someone may have withdrawn it already. Refresh the page to see its current status.'
    : 'This document is no longer withdrawn. Someone may have reinstated it already. Refresh the page to see its current status.'

  // a. Find it, and check it is in the state the change starts from.
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  const document = await KnowledgeDocumentModel.findById(id)
  if (!document) throw new KnowledgeDocumentNotFoundError()
  const alreadyThere = Boolean(document.withdrawn) === Boolean(by)
  if (document.status !== 'complete' || alreadyThere) {
    throw new KnowledgeDocumentWrongStateError(wrongState)
  }

  // b. Save the change, keeping the old value in case step c fails.
  const previous = document.toObject().withdrawn
  document.set('withdrawn', by && { at: new Date(), by })
  await document.save()

  // c. Put the new status on its passages in Chroma. If that fails, write the
  // old value back: without this, MongoDB would show the change while search
  // still used the old status.
  try {
    await relabelPassages(
      id,
      labels(document.toObject()),
      "The knowledge base couldn't be updated, so nothing changed. Try again shortly.",
    )
  } catch (error) {
    document.set('withdrawn', previous)
    await document.save()
    throw error
  }
  return toDto(document.toObject())
}

/**
 * Returns the document, now withdrawn by `by` (KB-01 AC12, AC14). Throws
 * KnowledgeDocumentNotFoundError, KnowledgeDocumentWrongStateError (not complete,
 * or already withdrawn), or IngestionUnavailableError, in which case the
 * document stays active.
 */
export const withdrawKnowledgeDocument = (id: string, by: { id: string; name: string }) =>
  setWithdrawn(id, by)

/**
 * Returns the document, active again (KB-01 AC16). Throws
 * KnowledgeDocumentNotFoundError, KnowledgeDocumentWrongStateError (not
 * withdrawn), or IngestionUnavailableError, in which case it stays withdrawn.
 */
export const reinstateKnowledgeDocument = (id: string) => setWithdrawn(id, undefined)

/**
 * Retries a failed ingestion without re-uploading. The PDF is still in S3 and
 * every detail is still on the record, so retry means re-run, not re-enter: the
 * document flips `failed → queued`, its failure fields are cleared, its retry
 * counter is bumped, and the ingestion job is re-queued. The worker then claims
 * it exactly as a fresh upload.
 *
 * Throws KnowledgeDocumentNotFoundError (unknown or malformed id),
 * KnowledgeDocumentWrongStateError (not currently failed), or
 * IngestionUnavailableError (the re-queue could not be placed), in which case
 * the document is put back to failed.
 */
export async function retryIngestion(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  // Atomic on `status: 'failed'`: only a failed document flips, so a double
  // click cannot queue two runs or double-count. The counter is bumped in the
  // same write, so it moves exactly when a retry is accepted — never on the
  // worker's own automatic re-runs.
  const updated = await KnowledgeDocumentModel.findOneAndUpdate(
    { _id: id, status: 'failed' },
    {
      $set: { status: 'queued' },
      $unset: { error: 1, finishedAt: 1, result: 1 },
      $inc: { retryCount: 1 },
    },
    { returnDocument: 'after' },
  ).lean()
  if (!updated) {
    // One of two reasons, disambiguated like retryTranscription.
    if (await KnowledgeDocumentModel.exists({ _id: id })) {
      throw new KnowledgeDocumentWrongStateError('Only a failed document can be retried.')
    }
    throw new KnowledgeDocumentNotFoundError()
  }
  // Re-queue, clearing the stale terminal job BullMQ still holds under this
  // document id (see requeueIngestion). If it cannot be placed, roll the status
  // and the counter back, so the document does not sit at `queued` with no job
  // and the attempt number is not inflated by a retry that never ran.
  try {
    await requeueIngestion(id)
  } catch {
    await KnowledgeDocumentModel.updateOne(
      { _id: id, status: 'queued' },
      {
        $set: {
          status: 'failed',
          error: 'Ingestion could not be re-queued. Try again shortly.',
          finishedAt: new Date(),
        },
        $inc: { retryCount: -1 },
      },
    )
    throw new IngestionUnavailableError('Ingestion could not be re-queued. Try again shortly.')
  }
}
