// Gateway (S2) calls for knowledge base documents (IN-01).
import { request } from '../accounts/api'

export type SourceType = 'fm_standard' | 'nfpa_standard' | 'marsh_report'
export type IngestionStatus = 'queued' | 'processing' | 'complete' | 'failed'

// What the admin enters for each file. effectiveDate is YYYY-MM-DD.
export type DocumentDetails = {
  title: string
  issuingBody: string
  edition: string
  effectiveDate: string
  sourceType: SourceType | ''
  jurisdiction: string
  facilityType: string
}

export type KnowledgeDocument = {
  id: string
  title: string
  issuingBody: string
  edition: string
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

// Sends one PDF with its details and returns the queued document. The details
// travel in the query string because the body is the file itself.
export function uploadKnowledgeDocument(
  file: File,
  details: DocumentDetails,
): Promise<KnowledgeDocument> {
  const query = new URLSearchParams({ fileName: file.name, ...details })
  return request<KnowledgeDocument>(`/api/knowledge-documents?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
}
