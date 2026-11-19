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

export type SourceType = 'fm_standard' | 'nfpa_standard' | 'local_standard' | 'marsh_report'
// `awaiting_type`: labelling couldn't read the source type, so the document is
// not ingested until an admin chooses one (IN-19). `draft`: a standard being
// entered clause by clause, not yet published (IN-18).
export type IngestionStatus =
  'draft' | 'awaiting_type' | 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled'

// How a document entered the knowledge base: an uploaded file, or typed in clause
// by clause (IN-18). A manual document has no file.
export type EntryMethod = 'upload' | 'manual'

// The stages a document moves through while processing (E2). Mirrors
// INGESTION_STAGES in server/src/models/ingestion-job.model.ts.
export const INGESTION_STAGES = [
  // Redaction before parsing, only for a protected report (PV-05).
  'anonymising',
  'parsing',
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
  // The page reached while parsing (pages parsed so far, in 20-page batches),
  // chunking or indexing, and the document's page total (E2b). The chunk count has no
  // knowable total up front, so progress is tracked by page. Both null at the
  // start of each stage until it reports a page.
  pageCurrent: number | null
  pageTotal: number | null
  // Table and formula regions read of those queued, during chunking's OCR pass.
  // Null until that pass starts, and on a document with nothing to read.
  ocrCurrent: number | null
  ocrTotal: number | null
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
  // A local standard's publisher, free text; '' for every other source type.
  issuingBody: string
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
// `replaces_manual`: one side was entered manually, the other is the same edition
// uploaded (IN-18).
export type MatchKind = 'newer_edition' | 'earlier_edition' | 'possible_copy' | 'replaces_manual'
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
  entryMethod: EntryMethod
  // The file's name, size and link; null on a manual document, which has none (IN-18).
  fileName: string | null
  sourceType: SourceType | null
  jurisdiction: string | null
  facilityType: string | null
  effectiveDate: string | null
  // The details still Unconfirmed; non-empty means "Needs review".
  unconfirmed: UnconfirmedDetail[]
  size: number | null
  status: IngestionStatus
  error: string | null
  uploadedAt: string
  fileUrl: string | null
  // The details each correction replaced, newest first (KB-01 AC9).
  history: DocumentVersion[]
  // Who took it out of use and when (KB-01 AC14); null while it is active.
  withdrawn: { at: string; by: { id: string; name: string } } | null
  // Who last reviewed, retried or cancelled it (F-10 round 3) and when; null if nobody has.
  handled: { at: string; by: { id: string; name: string } } | null
  // The document it matches, which makes it Needs review (IN-07); else null.
  match: DocumentMatch | null
  // For a withdrawn edition: the newest edition of its family (IN-07 AC14).
  newerEdition: { id: string; title: string; edition: string | null } | null
  // For a withdrawn edition: the family's active edition, which must be
  // withdrawn before this one can be reinstated (IN-07 AC15); else null.
  reinstateBlockedBy: { id: string; title: string; edition: string | null } | null
  // A report cites it: it can be withdrawn but not deleted (IN-12). Absent on older answers.
  cited?: boolean
  // Live ingestion progress (E2); present only while `status` is `processing`.
  progress?: IngestionProgress
}

// One previous version of a document's details: what a correction replaced,
// when, and who saved that correction.
export type DocumentVersion = {
  sourceType: SourceType | null
  title: string
  issuingBody: string | null
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
  | 'issuingBody'
  | 'standardNumber'
  | 'edition'
  | 'effectiveDate'
  | 'jurisdiction'
  | 'facilityType'
>

// One document by id, for the Inbox's already-handled check (F-10 round 3). A deleted one is a
// 404 (GatewayError.status).
export function getKnowledgeDocument(id: string, signal?: AbortSignal): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge-documents/${encodeURIComponent(id)}`, {
    signal,
  })
}

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
  issuingBody: '',
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

// ─── Manual entry (IN-18) ───────────────────────────────────────────────────

// A standard's details for a new manual entry, as Edit details sends them.
// `copyFrom` starts it from another edition's clauses (Start from).
export function createManualDocument(
  details: DocumentDetails,
  copyFrom?: string,
): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>('/api/knowledge-documents/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...Object.fromEntries(filled(details)), ...(copyFrom && { copyFrom }) }),
  })
}

export type ManualImageKind = 'table' | 'formula' | 'picture'
export type ManualImage = { key: string; kind: ManualImageKind; text: string }

// One clause of a manual document; matches ManualSectionDto in
// server/src/services/manual-section.service.ts.
export type ManualSection = {
  id: string
  // Its fixed number (its passages' ids); `order` is its place in the list.
  seq: number
  order: number
  clause: string
  headings: string[]
  text: string
  images: ManualImage[]
  // In search as saved; false after a failed embedding (`indexError` says why).
  indexed: boolean
  indexError: string | null
  // Saved by an admin for this edition; false for a clause copied from another.
  checked: boolean
  copiedFrom: { documentId: string; clause: string } | null
  updatedBy: { id: string; name: string }
  updatedAt: string
}

// What the admin saves for a clause.
export type ClauseInput = {
  clause: string
  headings: string[]
  text: string
  images: ManualImage[]
  order?: number
}

const sectionsPath = (id: string) => `/api/knowledge-documents/${encodeURIComponent(id)}/sections`

export function listManualSections(id: string, signal?: AbortSignal): Promise<ManualSection[]> {
  return request<ManualSection[]>(sectionsPath(id), { signal })
}

export function addManualSection(id: string, clause: ClauseInput): Promise<ManualSection> {
  return request<ManualSection>(sectionsPath(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clause),
  })
}

// Saves a change; `updatedAt` is the one it was loaded with, so a newer save is not overwritten.
export function changeManualSection(
  id: string,
  sectionId: string,
  clause: ClauseInput,
  updatedAt: string,
): Promise<ManualSection> {
  return request<ManualSection>(`${sectionsPath(id)}/${encodeURIComponent(sectionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...clause, updatedAt }),
  })
}

// A screenshot read by OCR and stored, for a clause to hold once saved. `text` is
// '' with `readError` saying why when OCR read nothing, so the admin types it.
export type Screenshot = ManualImage & { readError: string | null }

// Reads a table, formula or picture screenshot with OCR and stores it (IN-18).
// `context` is the clause's heading trail, which helps a picture's description.
// Rejects with the gateway's reason: 415 not a PNG, JPG or WebP, 413 over 10 MB.
export function uploadScreenshot(
  id: string,
  file: File,
  kind: ManualImageKind,
  context: string,
): Promise<Screenshot> {
  const query = new URLSearchParams({ kind, context })
  return request<Screenshot>(`${sectionsPath(id)}/screenshots?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
}

// Where a saved clause's screenshot is shown from (a key's last part is its name).
export const screenshotUrl = (id: string, key: string) =>
  `${sectionsPath(id)}/screenshots/${encodeURIComponent(key.split('/').pop() ?? '')}`

export function deleteManualSection(id: string, sectionId: string): Promise<void> {
  return send(`${sectionsPath(id)}/${encodeURIComponent(sectionId)}`, { method: 'DELETE' })
}

export function reembedManualSection(id: string, sectionId: string): Promise<ManualSection> {
  return request<ManualSection>(`${sectionsPath(id)}/${encodeURIComponent(sectionId)}/reembed`, {
    method: 'POST',
  })
}

// Publishes a manual draft and returns it, active or Needs review (IN-18).
// Rejects with the gateway's reason: 409 when a clause isn't indexed or checked yet.
export function publishManualDocument(id: string): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge-documents/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  })
}

// Takes a document out of use and returns it with `withdrawn` set (KB-01).
export function withdrawDocument(id: string): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge-documents/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
  })
}

// Permanently deletes a document uploaded by mistake (IN-12). 204 on success;
// rejects with the gateway's reason: 409 when a report cites it or it is still
// being ingested, 503 when the knowledge base could not be updated.
export function deleteKnowledgeDocument(id: string): Promise<void> {
  return send(`/api/knowledge-documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
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

// Chooses the source type of a document awaiting one and starts its ingestion
// (IN-19); returns the document, now queued. Rejects with the gateway's
// reason: 409 if it no longer awaits a type, 503 if the queue is unreachable.
export function chooseSourceType(id: string, sourceType: SourceType): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(
    `/api/knowledge-documents/${encodeURIComponent(id)}/source-type`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType }),
    },
  )
}

// Stops a queued or processing ingestion. 202 on accept; queued documents
// become cancelled immediately, while processing documents finish
// cooperatively in the worker.
export function cancelIngestion(id: string): Promise<void> {
  return send(`/api/knowledge-documents/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
}

// Sends one file (a PDF, or a Word, PowerPoint, RTF or ODT file the gateway
// converts to one) with its details and returns the queued document. The body is
// the raw file and the details go in the URL's query string, so the gateway
// needs no multipart-form library.
export function uploadKnowledgeDocument(
  file: File,
  details: DocumentDetails = EMPTY_DETAILS,
): Promise<KnowledgeDocument> {
  const query = new URLSearchParams([['fileName', file.name], ...filled(details)])
  return request<KnowledgeDocument>(`/api/knowledge-documents?${query}`, {
    method: 'POST',
    // The gateway reads the type from the file's bytes, but reads no body
    // without a Content-Type, so a file the browser can't name goes as bytes.
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
}

// One passage of a document as the knowledge base lists it (IN-17). `position` is its
// place in the whole document, filtered or not; `kind` what it was read from;
// `generated` marks text a model wrote, such as a picture's description (IN-13).
export type DocumentPassage = {
  id: string
  position: number
  text: string
  // The heading trail, outermost first; empty when the passage has none. Only the
  // last is reliable (see .claude/plans/ingestion-data-fixes.md, D1).
  headings: string[]
  section: string | null
  pageStart: number | null
  pageEnd: number | null
  status: string | null
  kind: 'text' | 'table' | 'formula' | 'picture'
  generated: boolean
}

// A chapter or section of a document's outline and how many passages it holds. "" is
// front matter as a chapter, or a chapter's start before its first section. `title` comes
// from its own heading ("Installation" for chapter 8), null when it has none.
export type OutlineEntry = { name: string; count: number; title: string | null }

// One page of a document's passages, how many match, and its outline. A standard is
// outlined by clause numbers (chapters, then the chosen chapter's sections); a past
// report by its template sections, as chapters with no second level.
export type PassageListing = {
  total: number
  passages: DocumentPassage[]
  outline: { by: 'clause' | 'section'; chapters: OutlineEntry[]; sections: OutlineEntry[] }
}

// What to list: a page, the outline's chapter and section, a page range, and words to
// search for (the best matches, ranked, within the rest), by words or by meaning (a paid
// Cohere search, the query masked first when protection is on).
export type PassageQuery = {
  offset: number
  limit: number
  chapter?: string
  section?: string
  pageFrom?: number
  pageTo?: number
  q?: string
  mode?: SearchMode
}
export type SearchMode = 'words' | 'meaning'

// Returns one page of a document's passages with its outline (IN-17).
export async function listDocumentPassages(
  id: string,
  query: PassageQuery,
  signal?: AbortSignal,
): Promise<PassageListing> {
  const params = new URLSearchParams({ offset: String(query.offset), limit: String(query.limit) })
  for (const key of ['chapter', 'section', 'pageFrom', 'pageTo', 'q', 'mode'] as const) {
    if (query[key] !== undefined) params.append(key, String(query[key]))
  }
  const path = `/api/knowledge-documents/${encodeURIComponent(id)}/passages?${params}`
  return request<PassageListing>(path, { signal })
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
  | 'keep_both'
  | 'discard_new'
  | 'discard_other'
  | 'supersede'
  | 'add_as_older'
  // IN-18: the PDF of a manually entered edition replaces the manual entry.
  | 'replace_manual'

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

// A request from a risk engineer to add the document behind a question the chatbot could
// not answer (CB-07). Matches the DTO of server/src/routes/knowledge-gap.routes.ts.
export type KnowledgeGapRequest = {
  id: string
  question: string
  message?: string
  askedBy: { id: string; name: string }
  createdAt: string
  status: 'open' | 'filled' | 'dismissed'
}

// One request as its read route answers (F-10 round 3). The list doesn't send `closed`.
export type KnowledgeGapRequestDetail = KnowledgeGapRequest & {
  // Who closed it (filled or dismissed) and when; null while it is open.
  closed: { at: string; by: { id: string; name: string } } | null
}

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// One request by id, for the Inbox's already-handled check (F-10 round 3). A deleted one is a 404
// (GatewayError.status).
export function getKnowledgeRequest(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeGapRequestDetail> {
  return request<KnowledgeGapRequestDetail>(`/api/knowledge-gaps/${encodeURIComponent(id)}`, {
    signal,
  })
}

// The open requests, newest first (knowledge admins only).
export async function listKnowledgeRequests(signal?: AbortSignal): Promise<KnowledgeGapRequest[]> {
  return (await request<{ requests: KnowledgeGapRequest[] }>('/api/knowledge-gaps', { signal }))
    .requests
}

// Closes a request as filled with the documents that were added. 409 if already closed.
export function fillKnowledgeRequest(id: string, documentIds: string[]): Promise<unknown> {
  return request(`/api/knowledge-gaps/${encodeURIComponent(id)}/fill`, jsonPost({ documentIds }))
}

// Closes a request as dismissed, with the reason the engineer will read. 409 if already closed.
export function dismissKnowledgeRequest(id: string, reason: string): Promise<unknown> {
  return request(`/api/knowledge-gaps/${encodeURIComponent(id)}/dismiss`, jsonPost({ reason }))
}
