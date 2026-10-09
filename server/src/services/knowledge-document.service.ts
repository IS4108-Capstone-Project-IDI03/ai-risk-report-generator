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
  type IDocumentMatch,
  type IKnowledgeDocument,
  type ILabelledDetail,
  type SourceType,
} from '../models/knowledge-document.model'
import type { IIngestionJob, IngestionStage } from '../models/ingestion-job.model'
import { getJobProgressBatch } from './ingestion-job.service'
import {
  enqueueIngestion,
  requeueIngestion,
  removeIngestionJob,
} from './ingestion-queue.service'
import {
  IngestionUnavailableError,
  labelDocument,
  matchDocument,
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

// The standard's designation without the issuing body, e.g. "13" or "2-81".
// A typed "NFPA 13" or "FM Global Data Sheet 2-81" keeps only the number, since
// matching compares numbers (without this, "NFPA 13" would never pair with "13").
const standardNumber = () =>
  text('Standard number', 40)
    .transform((value) => value.replace(/^(nfpa|fm global|fm)?\s*(data sheets?)?\s*/i, ''))
    .pipe(text('Standard number', 20))

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
      standardNumber: standardNumber(),
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
  standard_number: 'standardNumber',
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
  // Standards only (IN-07); null for a report or while Unconfirmed.
  standardNumber: string | null
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
    standardNumber: string | null
    effectiveDate: string | null
    jurisdiction: string | null
    facilityType: string | null
    replacedAt: Date
    replacedBy: { id: string; name: string }
  }[]
  // Live ingestion progress; present only while `status` is `processing` and a
  // matching ingestion_jobs row exists (E2).
  progress?: ProgressDto
  // The stored document this one repeats or updates (IN-07); null if none.
  // `otherNeedsReview` is true when that document is also waiting for a decision;
  // `document.withdrawn` changes what Keep both does (it keeps this one withdrawn too).
  match: {
    kind: IDocumentMatch['kind']
    document: { id: string; title: string; edition: string | null; withdrawn: boolean }
    newMatched: number
    newTotal: number
    storedMatched: number
    storedTotal: number
    otherNeedsReview: boolean
  } | null
  // For a withdrawn edition: the newest edition of its family, when later than
  // this one (IN-07 AC14); null otherwise.
  newerEdition: { id: string; title: string; edition: string | null } | null
  // For a withdrawn document: the active member of its edition family, which
  // blocks reinstating it (IN-07 AC15); null otherwise.
  reinstateBlockedBy: { id: string; title: string; edition: string | null } | null
}

type Doc = IKnowledgeDocument & { _id: Types.ObjectId }

// Whether a document waits for an admin: Unconfirmed details or a match (IN-07).
// A withdrawn document is out of search whatever else is true.
export const needsReview = (d: Pick<IKnowledgeDocument, 'unconfirmed' | 'match' | 'withdrawn'>) =>
  !d.withdrawn && (Boolean(d.unconfirmed?.length) || Boolean(d.match))

// The other documents a batch of DTOs refer to, read in one query each so a
// long list never costs one lookup per row.
type DtoRefs = { matched: Map<string, Doc>; newest: Map<string, Doc>; active: Map<string, Doc> }

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
function toDto(d: Doc, job: IIngestionJob | undefined, refs: DtoRefs): KnowledgeDocumentDto {
  const other = d.match && refs.matched.get(String(d.match.documentId))
  const newest = d.withdrawn && d.editionFamily && refs.newest.get(String(d.editionFamily))
  const blocker = d.withdrawn && d.editionFamily && refs.active.get(String(d.editionFamily))
  return {
    id: String(d._id),
    title: d.title,
    issuingBody: d.issuingBody ?? null,
    edition: d.edition ?? null,
    standardNumber: d.standardNumber ?? null,
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
      standardNumber: v.standardNumber ?? null,
      effectiveDate: isoDay(v.metadata.effective_date),
      jurisdiction: v.metadata.jurisdiction,
      facilityType: v.metadata.facility_type,
      replacedAt: v.replacedAt,
      replacedBy: v.replacedBy,
    })),
    // Only processing documents carry progress; the caller passes a job only
    // for those (see listKnowledgeDocuments).
    ...(job && d.status === 'processing' ? { progress: toProgressDto(job) } : {}),
    // A match whose document is gone shows as none; discarding re-matches the
    // documents that pointed at it, so this is only a brief gap.
    match:
      d.match && other
        ? {
            kind: d.match.kind,
            document: {
              id: String(other._id),
              title: other.title,
              edition: other.edition ?? null,
              withdrawn: Boolean(other.withdrawn),
            },
            newMatched: d.match.newMatched,
            newTotal: d.match.newTotal,
            storedMatched: d.match.storedMatched,
            storedTotal: d.match.storedTotal,
            otherNeedsReview: needsReview(other),
          }
        : null,
    newerEdition:
      newest && String(newest._id) !== String(d._id) && Number(newest.edition) > Number(d.edition)
        ? { id: String(newest._id), title: newest.title, edition: newest.edition ?? null }
        : null,
    reinstateBlockedBy: blocker
      ? { id: String(blocker._id), title: blocker.title, edition: blocker.edition ?? null }
      : null,
  }
}

/**
 * Returns the DTOs for these documents, in order. Looks up every matched
 * document and every withdrawn edition's family once for the whole batch.
 */
export async function toDtos(
  docs: Doc[],
  jobs: Map<string, IIngestionJob> = new Map(),
): Promise<KnowledgeDocumentDto[]> {
  const matchIds = docs.flatMap((d) => (d.match ? [d.match.documentId] : []))
  const families = docs.flatMap((d) => (d.withdrawn && d.editionFamily ? [d.editionFamily] : []))
  const [matchedDocs, members] = await Promise.all([
    matchIds.length ? KnowledgeDocumentModel.find({ _id: { $in: matchIds } }).lean() : [],
    families.length ? KnowledgeDocumentModel.find({ editionFamily: { $in: families } }).lean() : [],
  ])
  const refs: DtoRefs = { matched: new Map(), newest: new Map(), active: new Map() }
  for (const m of matchedDocs) refs.matched.set(String(m._id), m)
  for (const m of members) {
    const family = String(m.editionFamily)
    // The same condition as the reinstate guard in setWithdrawn: a member not withdrawn.
    if (!m.withdrawn) refs.active.set(family, m)
    if (Number(m.edition) > Number(refs.newest.get(family)?.edition ?? 0))
      refs.newest.set(family, m)
  }
  return docs.map((d) => toDto(d, jobs.get(String(d._id)), refs))
}

/** Returns the DTO for one document. */
export async function toDtoOf(d: Doc): Promise<KnowledgeDocumentDto> {
  return (await toDtos([d]))[0]
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
    standard_number: next.standardNumber ?? null,
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
    standardNumber: 'standardNumber' in details ? details.standardNumber : undefined,
    metadata: {
      source_type: details.sourceType,
      jurisdiction: details.jurisdiction,
      facility_type: details.facilityType,
      effective_date: new Date(details.effectiveDate),
    },
  }
}

// True when the source type (hence issuing body), standard number or edition
// changed: the details the ingestion service matches on (IN-07). Not the title.
function identityDiffers(old: IKnowledgeDocument, next: ReturnType<typeof recordFields>) {
  return (
    old.edition !== next.edition ||
    old.standardNumber !== next.standardNumber ||
    old.issuingBody !== next.issuingBody ||
    old.metadata.source_type !== next.metadata.source_type
  )
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
    old.standardNumber !== next.standardNumber ||
    a.source_type !== b.source_type ||
    a.jurisdiction !== b.jurisdiction ||
    a.facility_type !== b.facility_type ||
    a.effective_date?.getTime() !== b.effective_date.getTime()
  )
}

/**
 * Returns the labels every passage of the document carries, so search can
 * filter on them: its metadata, the date as YYYY-MM-DD, and `status`, which
 * search uses to skip passages that are not `active`: `withdrawn` (KB-01) or
 * `needs_review` (IN-05 some detail Unconfirmed, IN-07 a match). Null details are left out
 * (Chroma can't store null, and no filter should match them), and
 * `section` is never sent, so a relabel can't overwrite each passage's own
 * report section (IN-05).
 * Must match `labels()` in microservices/ingestion-service/app/worker.py,
 * which labels passages at ingest.
 */
export function labels({
  metadata,
  withdrawn,
  unconfirmed,
  match,
}: Pick<IKnowledgeDocument, 'metadata' | 'withdrawn' | 'unconfirmed' | 'match'>) {
  const details = {
    source_type: metadata.source_type,
    jurisdiction: metadata.jurisdiction,
    facility_type: metadata.facility_type,
    effective_date: isoDay(metadata.effective_date),
  }
  return {
    ...Object.fromEntries(Object.entries(details).filter(([, value]) => value != null)),
    status: withdrawn
      ? 'withdrawn'
      : needsReview({ unconfirmed, match })
        ? 'needs_review'
        : 'active',
  }
}

// A file IN-01 AC5 turns away. `status` is the HTTP status to answer with.
export class RejectedFileError extends Error {
  constructor(
    readonly status: 409 | 415 | 422,
    reason: string,
  ) {
    super(reason)
    this.name = 'RejectedFileError'
  }
}

// An identical file is already stored (IN-07 AC1): a 409 that names it.
export class DuplicateDocumentError extends RejectedFileError {
  constructor(
    stored: Pick<
      IKnowledgeDocument,
      'title' | 'edition' | 'status' | 'unconfirmed' | 'match' | 'withdrawn'
    >,
  ) {
    const shown = stored.withdrawn
      ? 'Withdrawn'
      : stored.status !== 'complete'
        ? 'Being ingested'
        : needsReview(stored)
          ? 'Needs review'
          : 'Active'
    const edition = stored.edition ? ` (${stored.edition} edition)` : ''
    super(409, `Already in the knowledge base as ${stored.title}${edition}, ${shown}.`)
    this.name = 'DuplicateDocumentError'
  }
}

// The stored document, if any, with this fingerprint. A failed one doesn't
// count, so its file can be uploaded again. Same condition as the unique index
// in models/knowledge-document.model.ts.
const findStoredCopy = (sha256: string) =>
  KnowledgeDocumentModel.findOne({ 'file.sha256': sha256, status: { $ne: 'failed' } }).lean()

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
    standard_number:
      sourceType === 'marsh_report' ? null : valid(standardNumber(), 'standard_number'),
    // Never Unconfirmed: without a date, every upload would need review.
    effective_date: valid(common.effectiveDate, 'effective_date') ?? uploadDay(),
    jurisdiction: valid(country(allowAll), 'jurisdiction'),
    facility_type: valid(
      z.string().refine(...onTheList(allowAll ? [...FACILITY_TYPES, 'all'] : FACILITY_TYPES)),
      'facility_type',
    ),
  }
  // A report has no edition or standard number, so they are never "missing".
  const unconfirmed = DETAIL_NAMES.filter(
    (name) =>
      values[name] === null &&
      !((name === 'edition' || name === 'standard_number') && sourceType === 'marsh_report'),
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
    standardNumber: values.standard_number ?? undefined,
    metadata: {
      source_type: sourceType,
      jurisdiction: values.jurisdiction,
      facility_type: values.facility_type,
      effective_date: values.effective_date ? new Date(values.effective_date) : null,
    },
    unconfirmed,
    labelling: answer ? { labelledAt: new Date(), details } : undefined,
  }
}

// Stores the original PDF in S3, records it with the details auto-labelling
// reads from it and queues its ingestion (IN-01, IN-05, IN-07), in steps a–g.
// Throws RejectedFileError before labelling or storing anything if the file is
// a repeat (IN-07 AC1), not a PDF or cannot be opened (IN-01 AC5), so a
// rejected file leaves no trace.
export async function uploadKnowledgeDocument(
  pdf: Buffer,
  contentType: string,
  fileName: string,
): Promise<KnowledgeDocumentDto> {
  // a. Is it a file we already hold? First, so a repeat costs no PDF check,
  // no LLM call, no S3 write and no job. sha256 is a fingerprint: equal
  // fingerprints mean equal files.
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  const stored = await findStoredCopy(sha256)
  if (stored) throw new DuplicateDocumentError(stored)

  // b. Is it really a PDF? Cheap, so it runs next.
  if (
    contentType.split(';')[0].trim() !== 'application/pdf' ||
    !pdf.subarray(0, 5).equals(PDF_MARKER)
  ) {
    throw new RejectedFileError(415, 'Only PDF files can be uploaded.')
  }
  // c. Does it open? Asks the ingestion service (see ingestion.service.ts).
  const cannotOpen = await whyPdfCannotOpen(pdf)
  if (cannotOpen) throw new RejectedFileError(422, cannotOpen)

  // d. Read its details. Never fails the upload: no answer means every
  // detail is Unconfirmed and an admin fills them in.
  const record = labelledRecord(await labelDocument(pdf), fileName)

  // e. Store the unaltered original in S3 (IN-01 AC4).
  const id = new Types.ObjectId()
  const key = `knowledge/${id}.pdf`
  await storage.putObject(key, pdf, 'application/pdf')

  // f. Record it in MongoDB as `queued`. The fingerprint also proves a copy
  // retrieved later matches the upload.
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
        sha256,
      },
      status: 'queued',
    })
  } catch (error) {
    // No transactions on a standalone mongod, so undo the upload by hand.
    await storage.deleteObject(key).catch(() => undefined)
    // 11000 = duplicate key: an identical file was stored between step a and
    // here (two copies uploaded together). Without this, the loser gets a 500.
    if ((error as { code?: number }).code === 11000) {
      const winner = await findStoredCopy(sha256)
      if (winner) throw new DuplicateDocumentError(winner)
    }
    throw error
  }
  // g. Queue its ingestion; the worker picks it up from there.
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
  return toDtoOf(document.toObject())
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

  return toDtos(documents, jobs)
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
  // Complete documents carry no progress, so no job is passed.
  return toDtos(documents)
}

// The review workspace resolves only the documents cited by a draft.
export async function findKnowledgeDocuments(ids: string[]): Promise<KnowledgeDocumentDto[]> {
  const valid = [...new Set(ids)].filter((id) => isValidObjectId(id))
  if (!valid.length) return []
  const documents = await KnowledgeDocumentModel.find({ _id: { $in: valid } }).lean()
  return toDtos(documents)
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
 * Returns the document with its corrected details (KB-01 AC6), in steps a–d.
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
  const {
    title,
    issuingBody,
    edition,
    standardNumber,
    metadata,
    history,
    unconfirmed,
    labelling,
    match,
  } = old
  const next = recordFields(details)
  document.set({ ...next, unconfirmed: [], labelling: adminLabelling(labelling, next) })
  if (differs(old, next)) {
    document.history.push({
      title,
      issuingBody,
      edition,
      standardNumber,
      metadata,
      replacedAt: new Date(),
      replacedBy: by,
    })
  }
  await document.save()

  // c. Put the new labels on its passages, in one of two ways. When the
  // correction could change the match (an identity detail changed, or the
  // document already has a match), /match relabels the passages itself from
  // MongoDB, with the final status (IN-07 AC5). Otherwise relabel directly.
  // Either way, if it fails, write the old details and history back: without
  // this, MongoDB would show the correction while search still used the old
  // labels (or a stale match).
  const rematch = Boolean(old.match) || identityDiffers(old, next)
  try {
    if (rematch) {
      await matchDocument(id).catch(() => {
        throw new IngestionUnavailableError(
          "The knowledge base couldn't be updated, so nothing changed. Try again shortly.",
        )
      })
    } else {
      await relabelPassages(
        id,
        labels(document.toObject()),
        'Search could not be updated, so the correction was not saved. Try again shortly.',
      )
    }
  } catch (error) {
    document.set({
      title,
      issuingBody,
      edition,
      standardNumber,
      metadata,
      history,
      unconfirmed,
      labelling,
      // /match may have saved a new match before failing.
      match: match ?? null,
    })
    // The in-memory match never changed, so Mongoose must be told to write it
    // back over the one /match saved behind its back.
    document.markModified('match')
    await document.save()
    throw error
  }
  const refreshed = await KnowledgeDocumentModel.findById(id).lean()
  return toDtoOf(refreshed ?? document.toObject())
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
  // Two editions of one standard are never active together (IN-07 AC15).
  if (!by && document.editionFamily) {
    const active = await KnowledgeDocumentModel.findOne({
      editionFamily: document.editionFamily,
      _id: { $ne: document._id },
      withdrawn: { $exists: false },
    }).lean()
    if (active) {
      const edition = active.edition ? ` (${active.edition} edition)` : ''
      throw new KnowledgeDocumentWrongStateError(`Withdraw ${active.title}${edition} first.`)
    }
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
  return toDtoOf(document.toObject())
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
 * Stops a queued or processing ingestion. A queued document becomes terminal
 * immediately; a processing document keeps its status until the worker sees
 * `cancelRequestedAt` and cleans up any partial passages.
 *
 * Throws KnowledgeDocumentNotFoundError for an unknown or malformed id, or
 * KnowledgeDocumentWrongStateError when the document is already terminal.
 */
export async function cancelIngestion(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()

  const now = new Date()
  const queued = await KnowledgeDocumentModel.findOneAndUpdate(
    { _id: id, status: 'queued' },
    {
      $set: { status: 'cancelled', cancelledAt: now },
      $unset: { error: 1, result: 1, finishedAt: 1, cancelRequestedAt: 1 },
    },
    { returnDocument: 'after' },
  ).lean()

  if (queued) {
    // MongoDB is authoritative. If Redis removal fails, the worker will still
    // skip this document because its status is already terminal.
    await removeIngestionJob(id).catch((error: unknown) => {
      console.error('Removing cancelled ingestion job failed:', error)
    })
    return
  }

  const processing = await KnowledgeDocumentModel.findOneAndUpdate(
    { _id: id, status: 'processing', cancelRequestedAt: { $exists: false } },
    { $set: { cancelRequestedAt: now } },
    { returnDocument: 'after' },
  ).lean()
  if (processing) return

  const document = await KnowledgeDocumentModel.findById(id).select({ status: 1 }).lean()
  if (!document) throw new KnowledgeDocumentNotFoundError()
  if (document.status === 'processing') return
  throw new KnowledgeDocumentWrongStateError('Only a queued or processing document can be stopped.')
}

/**
 * Retries a failed ingestion without re-uploading. The PDF is still in S3 and
 * every detail is still on the record, so retry means re-run, not re-enter: the
 * document flips `failed` or `cancelled` → `queued`, its terminal fields are
 * cleared, its retry counter is bumped, and the ingestion job is re-queued.
 * The worker then claims it exactly as a fresh upload.
 *
 * Throws KnowledgeDocumentNotFoundError (unknown or malformed id),
 * KnowledgeDocumentWrongStateError (not currently failed or cancelled), or
 * IngestionUnavailableError (the re-queue could not be placed), in which case
 * the document is put back to its previous terminal state.
 */
export async function retryIngestion(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  // Atomic on terminal retryable statuses: only a failed or cancelled document
  // flips, so a double click cannot queue two runs or double-count. The counter
  // is bumped in the same write, so it moves exactly when a retry is accepted.
  const updated = await KnowledgeDocumentModel.findOneAndUpdate(
    { _id: id, status: { $in: ['failed', 'cancelled'] } },
    {
      $set: { status: 'queued' },
      $unset: {
        error: 1,
        finishedAt: 1,
        cancelRequestedAt: 1,
        cancelledAt: 1,
      },
      $inc: { retryCount: 1 },
    },
    // Keep the matched terminal document so a queue failure can restore the
    // exact terminal state that the retry started from.
    // Keep the matched terminal document so a queue failure can restore the
    // exact terminal state that the retry started from.
    { returnDocument: 'before' },
  )
    .lean()
    .catch((error: unknown) => {
      // 11000 = duplicate key: the same file was uploaded again after this one
      // failed and is now stored (IN-07 allows one non-failed copy per file).
      // Without this the admin would get a 500 instead of the reason.
      if ((error as { code?: number }).code === 11000) {
        throw new KnowledgeDocumentWrongStateError(
          'An identical file is already in the knowledge base.',
        )
      }
      throw error
    })
  if (!updated) {
    // One of two reasons, disambiguated like retryTranscription.
    if (await KnowledgeDocumentModel.exists({ _id: id })) {
      throw new KnowledgeDocumentWrongStateError(
        'Only a failed or cancelled document can be retried.',
      )
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
    const rolledBackStatus = updated.status
    await KnowledgeDocumentModel.updateOne(
      { _id: id, status: 'queued' },
      rolledBackStatus === 'cancelled'
        ? {
            $set: { status: 'cancelled', cancelledAt: new Date() },
            $inc: { retryCount: -1 },
          }
        : {
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
