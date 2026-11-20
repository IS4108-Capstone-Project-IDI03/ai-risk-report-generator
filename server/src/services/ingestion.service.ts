// The gateway's calls to the ingestion service (app/api/routes.py): the PDF
// check (IN-01), which opens the file with PyMuPDF because Node has no PDF
// library, reading a file's details (IN-05 /label), relabelling a document's passages (KB-01),
// and matching, comparing and deleting passages (IN-07), because only the Python
// services touch Chroma.
import type { IDocumentMatch } from '../models/knowledge-document.model'
import { config } from '../config'
import { labelUsageToWire, recordAiCalls } from './ai-usage.service'
import { ingestionPrivacy } from './privacy.service'

// Ingestion (its service or its queue) is down; the upload can be retried.
export class IngestionUnavailableError extends Error {
  constructor(message = 'The ingestion service could not check the file. Try again shortly.') {
    super(message)
    this.name = 'IngestionUnavailableError'
  }
}

// Asks the ingestion service to open the PDF. Returns why it cannot be opened
// (its 422 reason), or null when it opens fine. Throws IngestionUnavailableError
// if the service is down or answers anything else, which becomes a 503.
export async function whyPdfCannotOpen(pdf: Buffer): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(`${config.ingestionServiceUrl}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(pdf),
    })
  } catch {
    throw new IngestionUnavailableError()
  }
  if (response.ok) return null
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown }
  if (response.status === 422 && typeof body.detail === 'string') return body.detail
  throw new IngestionUnavailableError()
}

// Text from a client's document (CP-23): the file itself, then each email
// attachment ingestion could read, each a document with its own name, and the
// attachments it couldn't read, with the reason.
export type ExtractedText = {
  documents: { name: string; text: string }[]
  failed?: { name: string; size: number; reason: string }[]
}

// Asks the ingestion service for a file's text (CP-23 /extract-text, which
// writes nothing). `fileName` names its type by its extension. Returns the
// documents, or `{ reason }` when the file can't be read (its 422 or 415
// answer), so the other files are still read. Throws IngestionUnavailableError
// if the service is down or answers anything else, which becomes a 503.
export async function extractText(
  file: Buffer,
  fileName: string,
): Promise<ExtractedText | { reason: string }> {
  const unavailable = new IngestionUnavailableError(
    'The documents could not be read just now. Try again shortly.',
  )
  const url = `${config.ingestionServiceUrl}/extract-text?filename=${encodeURIComponent(fileName)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(file),
  }).catch(() => {
    throw unavailable
  })
  const body = (await response.json().catch(() => ({}))) as {
    detail?: unknown
    documents?: unknown
  }
  if (response.status === 422 || response.status === 415) {
    const detail =
      typeof body.detail === 'string' ? body.detail : `${fileName} could not be opened.`
    // Ingestion says so in words; the board's copy (CP-23 R7 · 4) is shorter.
    if (/password-protected/i.test(detail)) {
      return { reason: 'Password-protected. Remove the password and add it again.' }
    }
    if (/damaged/i.test(detail)) {
      return { reason: 'File is damaged. Save it again as a PDF and add it.' }
    }
    return { reason: detail }
  }
  if (!response.ok || !Array.isArray(body.documents)) throw unavailable
  return body as ExtractedText
}

// One detail in the /label answer. `value` is null when Unconfirmed.
export type LabelledDetailAnswer = {
  value: unknown
  confidence: number
  evidence: { page: number; quote: string } | null
  model: string
}
export type LabelAnswer = { details: Record<string, LabelledDetailAnswer>; usage?: unknown }

// Scanned PDFs are OCR'd first: ~30 s alone in Docker, ~100 s while the worker
// OCRs another scan (measured 2026-10-07). Past this, every detail is Unconfirmed.
const LABEL_TIMEOUT_MS = 180_000

// Asks the ingestion service to read the PDF's details (IN-05). Returns its
// answer, or null on any failure (down, timeout, non-2xx, bad JSON): without
// this, a model outage would block every upload, and a null just leaves every
// detail Unconfirmed. Its paid calls are recorded against `documentId`.
export async function labelDocument(pdf: Buffer, documentId?: string): Promise<LabelAnswer | null> {
  try {
    // The PDF and whether, and against which names, its pages are masked before
    // any model reads them (PV-05). Inside the try: if the names can't be read,
    // the document is not labelled at all, rather than labelled unprotected.
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'upload.pdf')
    form.append('privacy', JSON.stringify(await ingestionPrivacy()))
    const response = await fetch(`${config.ingestionServiceUrl}/label`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`/label answered ${response.status}`)
    const answer = (await response.json()) as LabelAnswer
    if (typeof answer?.details !== 'object' || answer.details === null) {
      throw new Error('/label answered without details')
    }
    await recordAiCalls(labelUsageToWire(answer.usage), { documentId })
    return answer
  } catch (error) {
    console.error('Labelling failed; details left Unconfirmed:', error)
    return null
  }
}

// Puts a document's labels on all its passages in Chroma (KB-01 corrections,
// KB-01 withdraw and reinstate). Throws IngestionUnavailableError with
// `failureMessage` if the service is down or refuses, so the caller can undo
// its change.
export async function relabelPassages(
  id: string,
  labels: object,
  failureMessage: string,
): Promise<void> {
  const failed = new IngestionUnavailableError(failureMessage)
  const response = await fetch(`${config.ingestionServiceUrl}/documents/${id}/labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(labels),
  }).catch(() => {
    throw failed
  })
  if (!response.ok) throw failed
}

// One clause of a manual document as ingestion indexes it (IN-18): its text with
// its screenshots' corrected text, and each screenshot's key and kind only.
export type ManualSectionPayload = {
  seq: number
  order: number
  clause: string
  headings: string[]
  text: string
  images: { key: string; kind: string }[]
}

// One clause is one embedding call, but Cohere can be slow or rate-limited.
const MANUAL_SECTION_TIMEOUT_MS = 60_000

// Indexes one clause of a manual document, replacing its passages (IN-18), and
// records the embedding against the document. Throws IngestionUnavailableError
// if ingestion is down or refuses; the clause's old passages are then kept.
export async function indexManualSection(
  documentId: string,
  sectionId: string,
  payload: ManualSectionPayload,
): Promise<void> {
  const failed = new IngestionUnavailableError(
    "Search couldn't be updated with this clause. Re-embed it to try again.",
  )
  const response = await fetch(
    `${config.ingestionServiceUrl}/documents/${documentId}/manual-sections/${sectionId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MANUAL_SECTION_TIMEOUT_MS),
    },
  ).catch(() => {
    throw failed
  })
  if (!response.ok) throw failed
  const answer = (await response.json().catch(() => ({}))) as { usage?: unknown }
  await recordAiCalls(answer.usage, { documentId })
}

// One clause of an earlier edition, as ingestion groups its passages (IN-18).
export type DocumentClause = { clause: string; headings: string[]; text: string }

// An uploaded document's text grouped into clauses, to start a new manual edition
// from (IN-18). Throws IngestionUnavailableError if ingestion is down.
export async function documentClauses(id: string): Promise<DocumentClause[]> {
  const answer = await callIngestion<{ clauses: DocumentClause[] }>(
    `/documents/${id}/clauses`,
    'GET',
    "The earlier edition couldn't be read, so nothing was created. Try again shortly.",
  )
  return answer.clauses
}

// Ingestion couldn't open a screenshot as an image (its 422): the reason is shown to the admin.
export class ScreenshotRejectedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ScreenshotRejectedError'
  }
}

// OCR on a screenshot takes one model call; a big table can take a while.
const RECOGNISE_TIMEOUT_MS = 90_000

/**
 * Reads a manual clause's screenshot with OCR_PROVIDER (IN-18): table records,
 * LaTeX or a picture's description, recorded against the document. Returns
 * null when it couldn't be read (the provider read nothing, or ingestion is
 * down), so the admin can type the text instead. Throws ScreenshotRejectedError
 * when the file isn't an image ingestion can open.
 */
export async function recogniseScreenshot(
  documentId: string,
  image: Buffer,
  kind: string,
  context: string,
): Promise<string | null> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(image)]), 'screenshot')
  form.append('kind', kind)
  form.append('documentId', documentId)
  form.append('context', context)
  try {
    const response = await fetch(`${config.ingestionServiceUrl}/recognise`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(RECOGNISE_TIMEOUT_MS),
    })
    const answer = (await response.json().catch(() => ({}))) as {
      text?: unknown
      usage?: unknown
      detail?: unknown
    }
    if (response.status === 422) {
      throw new ScreenshotRejectedError(
        typeof answer.detail === 'string' ? answer.detail : 'The image could not be opened.',
      )
    }
    if (!response.ok || typeof answer.text !== 'string') return null
    await recordAiCalls(answer.usage, { documentId })
    return answer.text
  } catch (error) {
    if (error instanceof ScreenshotRejectedError) throw error
    console.error('Reading a screenshot failed:', error)
    return null
  }
}

// Deletes one clause's passages from search (IN-18). Throws IngestionUnavailableError.
export async function deleteManualSectionPassages(
  documentId: string,
  sectionId: string,
): Promise<void> {
  await callIngestion(
    `/documents/${documentId}/manual-sections/${sectionId}`,
    'DELETE',
    "The clause couldn't be removed from search, so it was kept. Try again shortly.",
  )
}

// Calls an ingestion endpoint that must succeed; any failure is an
// IngestionUnavailableError carrying `failureMessage` (a 503 for the caller).
async function callIngestion<T>(path: string, method: string, failureMessage: string): Promise<T> {
  const failed = new IngestionUnavailableError(failureMessage)
  const response = await fetch(`${config.ingestionServiceUrl}${path}`, { method }).catch(() => {
    throw failed
  })
  if (!response.ok) throw failed
  return (await response.json().catch(() => {
    throw failed
  })) as T
}

// What the ingestion service finds for a document (IN-07); `documentId` is a string.
export type MatchAnswer = {
  kind: IDocumentMatch['kind']
  documentId: string
  newMatched: number
  newTotal: number
  storedMatched: number
  storedTotal: number
}

// Asks the ingestion service to recompute a document's match, save it and
// relabel the passages (IN-07). Returns the match, or null when there is none.
export async function matchDocument(id: string): Promise<MatchAnswer | null> {
  const answer = await callIngestion<{ match: MatchAnswer | null }>(
    `/documents/${id}/match`,
    'POST',
    'The knowledge base could not check for duplicates. Try again shortly.',
  )
  return answer.match
}

// Deletes all of a document's passages from Chroma (IN-07 discard). Safe to repeat.
export async function deletePassages(id: string): Promise<void> {
  await callIngestion(
    `/documents/${id}/passages`,
    'DELETE',
    "The knowledge base couldn't be updated, so nothing was removed. Try again shortly.",
  )
}

export type ComparisonPassage = {
  id: string
  text: string
  pageStart: number | null
  pageEnd: number | null
}
export type ComparisonRow = {
  new: ComparisonPassage | null
  stored: ComparisonPassage | null
  differs: boolean
}

// One passage as the knowledge base browser lists it (IN-17). `position` is its place in
// the whole document; `kind` what it was read from; `generated` marks machine-written text.
export type DocumentPassage = {
  id: string
  position: number
  text: string
  headings: string[]
  section: string | null
  pageStart: number | null
  pageEnd: number | null
  status: string | null
  kind: 'text' | 'table' | 'formula' | 'picture'
  generated: boolean
  // A manual clause's screenshot keys (IN-18); empty for every other passage.
  images: string[]
}

// A chapter or section of the document's outline, with how many passages it holds. ""
// is front matter as a chapter, or a chapter's start before its first section. `title`
// comes from its own heading, null when it has none.
export type OutlineEntry = { name: string; count: number; title: string | null }

// One page of a document's passages, how many match, and its outline (IN-17).
export type PassageListing = {
  total: number
  passages: DocumentPassage[]
  outline: { by: 'clause' | 'section'; chapters: OutlineEntry[]; sections: OutlineEntry[] }
}

// What to list: a page, the outline's chapter and section, a page range, and (from a
// search) the passages' ids in rank order.
export type PassageQuery = {
  offset: number
  limit: number
  chapter?: string
  section?: string
  pageFrom?: number
  pageTo?: number
  ids?: string[]
}

// Returns one page of a document's passages, in reading order or the ids' order (IN-17).
export async function listPassages(id: string, query: PassageQuery): Promise<PassageListing> {
  const params = new URLSearchParams({ offset: String(query.offset), limit: String(query.limit) })
  if (query.chapter !== undefined) params.append('chapter', query.chapter)
  if (query.section !== undefined) params.append('section', query.section)
  if (query.pageFrom !== undefined) params.append('pageFrom', String(query.pageFrom))
  if (query.pageTo !== undefined) params.append('pageTo', String(query.pageTo))
  for (const passageId of query.ids ?? []) params.append('ids', passageId)
  return callIngestion<PassageListing>(
    `/documents/${id}/passages?${params}`,
    'GET',
    'The passages could not be loaded. Try again shortly.',
  )
}

// Returns the aligned passages of a document and the one it matches (IN-07 AC7).
export async function getComparison(id: string, otherId: string): Promise<ComparisonRow[]> {
  const answer = await callIngestion<{ rows: ComparisonRow[] }>(
    `/documents/${id}/comparison/${otherId}`,
    'GET',
    'The comparison could not be loaded. Try again shortly.',
  )
  return answer.rows
}
