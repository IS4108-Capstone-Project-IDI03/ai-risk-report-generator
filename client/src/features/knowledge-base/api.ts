// Browser → gateway requests for knowledge base documents (IN-01, KB-01, IN-05).
// uploads.ts uses the upload; KnowledgeBase.tsx uses the recent uploads list;
// KnowledgeDocuments.tsx uses the active list, corrections, withdraw and reinstate;
// screens/ReviewDocument.tsx uses the comparison and the decision (IN-07). A failed request
// throws a GatewayError carrying the HTTP status, which uploads.ts reads to
// decide what happens to the row.
import { request } from '../accounts/api'
import { GatewayError, reportSessionEnded } from '../assessments/api'

// A gateway call that returns no body (e.g. the 202 from retry). The shared
// `request` always parses JSON, which an empty 202 cannot provide, so these
// mirror its error and 401 handling without the parse.
async function send(path: string, init: RequestInit): Promise<void> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error: unknown) {
    if (init.signal?.aborted) throw error
    throw new GatewayError(null)
  }
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (response.status === 401) reportSessionEnded()
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { error?: string }
    throw new GatewayError(response.status, problem.error)
  }
}

export type SourceType = 'fm_standard' | 'nfpa_standard' | 'marsh_report'
export type IngestionStatus = 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled'

// The stages a document moves through while processing (E2). Mirrors
// INGESTION_STAGES in server/src/models/ingestion-job.model.ts.
export const INGESTION_STAGES = [
  'parsing',
  'anonymising',
  'chunking',
  'indexing',
  'complete',
  'failed',
] as const
export type IngestionStage = (typeof INGESTION_STAGES)[number]

// Live ingestion progress for a processing document (E2). Present on a
// KnowledgeDocument only while `status` is `processing` and the worker has
// written its first stage; matches ProgressDto in
// server/src/services/knowledge-document.service.ts.
export type IngestionProgress = {
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

// What the admin enters in Edit details. Which fields apply depends on the
// source type (see details.ts); unused ones stay ''. effectiveDate is
// YYYY-MM-DD (a standard's effective date, or a report's report date); edition
// is a standard's year.
export type DocumentDetails = {
  sourceType: SourceType | ''
  title: string
  // A standard's number without its issuing body, e.g. "13" for NFPA 13 (IN-07).
  standardNumber: string
  edition: string
  effectiveDate: string
  jurisdiction: string
  facilityType: string
}

// The details labelling can leave Unconfirmed (IN-05); matches DetailDtoName
// in server/src/services/knowledge-document.service.ts.
export type UnconfirmedDetail =
  | 'sourceType'
  | 'title'
  | 'standardNumber'
  | 'edition'
  | 'effectiveDate'
  | 'jurisdiction'
  | 'facilityType'

// What a document matches in the knowledge base (IN-07). The counts always
// come from the copy check, also for an edition match; matches the DTO in
// server/src/services/knowledge-document.service.ts.
export type MatchKind = 'newer_edition' | 'earlier_edition' | 'possible_copy'
export type DocumentMatch = {
  kind: MatchKind
  // `withdrawn`: Keep both then keeps this document withdrawn too.
  document: { id: string; title: string; edition: string | null; withdrawn: boolean }
  newMatched: number
  newTotal: number
  storedMatched: number
  storedTotal: number
  // The other document is itself waiting for a decision (e.g. same batch).
  otherNeedsReview: boolean
}

// One accepted document as the gateway sends it; matches toDto() in
// server/src/services/knowledge-document.service.ts. A detail that is null
// is Unconfirmed (IN-05).
export type KnowledgeDocument = {
  id: string
  title: string
  issuingBody: string | null
  // null for a past report, which has no edition, or while Unconfirmed.
  edition: string | null
  // A standard's number, e.g. "13" for NFPA 13; null like edition (IN-07).
  standardNumber: string | null
  fileName: string
  sourceType: SourceType | null
  jurisdiction: string | null
  facilityType: string | null
  effectiveDate: string | null
  // The details still Unconfirmed; non-empty means "Needs review".
  unconfirmed: UnconfirmedDetail[]
  size: number
  status: IngestionStatus
  error: string | null
  uploadedAt: string
  fileUrl: string
  // The details each correction replaced, newest first (KB-01 AC9).
  history: DocumentVersion[]
  // Who took it out of use and when (KB-01 AC14); null while it is active.
  withdrawn: { at: string; by: { id: string; name: string } } | null
  // The document it matches, which makes it Needs review (IN-07); else null.
  match: DocumentMatch | null
  // For a withdrawn edition: the newest edition of its family (IN-07 AC14).
  newerEdition: { id: string; title: string; edition: string | null } | null
  // For a withdrawn edition: the family's active edition, which must be
  // withdrawn before this one can be reinstated (IN-07 AC15); else null.
  reinstateBlockedBy: { id: string; title: string; edition: string | null } | null
  // Live ingestion progress (E2); present only while `status` is `processing`.
  progress?: IngestionProgress
}

// One previous version of a document's details: what a correction replaced,
// when, and who saved that correction.
export type DocumentVersion = {
  sourceType: SourceType | null
  title: string
  standardNumber: string | null
  edition: string | null
  effectiveDate: string | null
  jurisdiction: string | null
  facilityType: string | null
  replacedAt: string
  replacedBy: { id: string; name: string }
}

// The details a correction can change, as stored: on a document, or on one
// of its previous versions.
export type StoredDetails = Pick<
  KnowledgeDocument,
  | 'sourceType'
  | 'title'
  | 'standardNumber'
  | 'edition'
  | 'effectiveDate'
  | 'jurisdiction'
  | 'facilityType'
>

// Every accepted upload with its ingestion status, newest first.
export function listKnowledgeDocuments(signal?: AbortSignal): Promise<KnowledgeDocument[]> {
  return request<KnowledgeDocument[]>('/api/knowledge-documents', { signal })
}

// Every ingested document, active or withdrawn, sorted by title (KB-01).
export function listIngestedDocuments(signal?: AbortSignal): Promise<KnowledgeDocument[]> {
  return request<KnowledgeDocument[]>('/api/knowledge-documents/ingested', { signal })
}

// Only the fields that apply: blank ones belong to the other source type, or
// are optional and the gateway fills in its default (a standard's facility
// type becomes "all").
const filled = (details: DocumentDetails) =>
  Object.entries(details).filter(([, value]) => value !== '')
const EMPTY_DETAILS: DocumentDetails = {
  sourceType: '',
  title: '',
  standardNumber: '',
  edition: '',
  effectiveDate: '',
  jurisdiction: '',
  facilityType: '',
}

// Saves a document's corrected details and returns the stored document (KB-01).
export function correctKnowledgeDocument(
  id: string,
  details: DocumentDetails,
): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge-documents/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(filled(details))),
  })
}

// Takes a document out of use and returns it with `withdrawn` set (KB-01).
export function withdrawDocument(id: string): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge-documents/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
  })
}

// Puts a withdrawn document back in use and returns it, `withdrawn` null (KB-01).
export function reinstateDocument(id: string): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(
    `/api/knowledge-documents/${encodeURIComponent(id)}/reinstate`,
    { method: 'POST' },
  )
}

// Retries a failed or cancelled ingestion without re-uploading (the gateway
// reuses the stored PDF and details). 202 on accept; the document returns to
// the list as queued. Rejects with the gateway's status: 409 if it is no longer
// retryable (someone retried it already), 404 if gone, 503 if the queue is
// unreachable.
export function retryIngestion(id: string): Promise<void> {
  return send(`/api/knowledge-documents/${encodeURIComponent(id)}/retry`, { method: 'POST' })
}

// Sends one PDF with its details and returns the queued document. The body is
// the raw PDF and the details go in the URL's query string, so the gateway
// needs no multipart-form library.
export function uploadKnowledgeDocument(
  file: File,
  details: DocumentDetails = EMPTY_DETAILS,
): Promise<KnowledgeDocument> {
  const query = new URLSearchParams([['fileName', file.name], ...filled(details)])
  return request<KnowledgeDocument>(`/api/knowledge-documents?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
}

// One passage in the side-by-side comparison (IN-07).
export type Passage = {
  id: string
  text: string
  pageStart: number | null
  pageEnd: number | null
}

// One aligned row: a stored passage, a new one, or both. `differs` is true
// when the pair is not a match.
export type ComparisonRow = { new: Passage | null; stored: Passage | null; differs: boolean }

export type Comparison = {
  document: KnowledgeDocument
  matched: KnowledgeDocument
  rows: ComparisonRow[]
}

// The choices on the Review page; discard_new and discard_other both delete a
// document, so the page asks first.
export type DecisionChoice =
  'keep_both' | 'discard_new' | 'discard_other' | 'supersede' | 'add_as_older'

// Returns a document set beside the document it matches (IN-07 AC7).
export function getComparison(id: string, signal?: AbortSignal): Promise<Comparison> {
  return request<Comparison>(`/api/knowledge-documents/${encodeURIComponent(id)}/comparison`, {
    signal,
  })
}

// Applies the admin's decision on a match and returns the reviewed document,
// or null once it has been discarded (IN-07). A refusal throws the server's reason.
export async function decide(
  id: string,
  choice: DecisionChoice,
): Promise<KnowledgeDocument | null> {
  const { document } = await request<{ document: KnowledgeDocument | null }>(
    `/api/knowledge-documents/${encodeURIComponent(id)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    },
  )
  return document
}
