// Browser → gateway requests for knowledge base documents (IN-01, KB-01, IN-05).
// uploads.ts uses the upload; KnowledgeBase.tsx uses the recent uploads list;
// KnowledgeDocuments.tsx uses the active list, corrections, withdraw and reinstate. A failed request
// throws a GatewayError carrying the HTTP status, which uploads.ts reads to
// decide what happens to the row.
import { request } from '../accounts/api'

export type SourceType = 'fm_standard' | 'nfpa_standard' | 'marsh_report'
export type IngestionStatus = 'queued' | 'processing' | 'complete' | 'failed'

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
  edition: string
  effectiveDate: string
  jurisdiction: string
  facilityType: string
}

// The details labelling can leave Unconfirmed (IN-05); matches DetailDtoName
// in server/src/services/knowledge-document.service.ts.
export type UnconfirmedDetail =
  'sourceType' | 'title' | 'edition' | 'effectiveDate' | 'jurisdiction' | 'facilityType'

// One accepted document as the gateway sends it; matches toDto() in
// server/src/services/knowledge-document.service.ts. A detail that is null
// is Unconfirmed (IN-05).
export type KnowledgeDocument = {
  id: string
  title: string
  issuingBody: string | null
  // null for a past report, which has no edition, or while Unconfirmed.
  edition: string | null
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
  // Live ingestion progress (E2); present only while `status` is `processing`.
  progress?: IngestionProgress
}

// One previous version of a document's details: what a correction replaced,
// when, and who saved that correction.
export type DocumentVersion = {
  sourceType: SourceType | null
  title: string
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
  'sourceType' | 'title' | 'edition' | 'effectiveDate' | 'jurisdiction' | 'facilityType'
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

// Sends one PDF and returns the queued document. The body is the raw PDF and
// the file name goes in the URL's query string, so the gateway needs no
// multipart-form library. The gateway reads the document's details itself
// (IN-05), so this takes a few seconds, up to ~30 s for a scanned PDF.
export function uploadKnowledgeDocument(file: File): Promise<KnowledgeDocument> {
  const query = new URLSearchParams({ fileName: file.name })
  return request<KnowledgeDocument>(`/api/knowledge-documents?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
}
