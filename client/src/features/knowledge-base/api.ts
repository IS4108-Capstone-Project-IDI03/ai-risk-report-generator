// Browser → gateway requests for knowledge base documents (IN-01, KB-01).
// uploads.ts uses the upload; KnowledgeBase.tsx uses the recent uploads list;
// KnowledgeDocuments.tsx uses the active list and corrections. A failed request
// throws a GatewayError carrying the HTTP status, which uploads.ts reads to
// decide what happens to the row.
import { request } from '../accounts/api'

export type SourceType = 'fm_standard' | 'nfpa_standard' | 'marsh_report'
export type IngestionStatus = 'queued' | 'processing' | 'complete' | 'failed'

// What the admin enters for each file. Which fields apply depends on the
// source type (see uploads.ts); unused ones stay ''. effectiveDate is
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

// One accepted document as the gateway sends it; matches toDto() in
// server/src/services/knowledge-document.service.ts.
export type KnowledgeDocument = {
  id: string
  title: string
  issuingBody: string
  // null for a past report, which has no edition.
  edition: string | null
  fileName: string
  sourceType: SourceType
  jurisdiction: string
  facilityType: string
  effectiveDate: string
  size: number
  status: IngestionStatus
  error: string | null
  uploadedAt: string
  fileUrl: string
}

// Every accepted upload with its ingestion status, newest first.
export function listKnowledgeDocuments(signal?: AbortSignal): Promise<KnowledgeDocument[]> {
  return request<KnowledgeDocument[]>('/api/knowledge-documents', { signal })
}

// Every active document (ingestion complete), sorted by title (KB-01).
export function listActiveDocuments(signal?: AbortSignal): Promise<KnowledgeDocument[]> {
  return request<KnowledgeDocument[]>('/api/knowledge-documents/active', { signal })
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

// Sends one PDF with its details and returns the queued document. The body is
// the raw PDF and the details go in the URL's query string, so the gateway
// needs no multipart-form library.
export function uploadKnowledgeDocument(
  file: File,
  details: DocumentDetails,
): Promise<KnowledgeDocument> {
  const query = new URLSearchParams([['fileName', file.name], ...filled(details)])
  return request<KnowledgeDocument>(`/api/knowledge-documents?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
}
