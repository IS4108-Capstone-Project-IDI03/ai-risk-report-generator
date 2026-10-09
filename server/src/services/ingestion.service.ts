// The gateway's calls to the ingestion service (app/api/routes.py): the PDF
// check (IN-01), which opens the file with PyMuPDF because Node has no PDF
// library, reading a file's details (IN-05 /label), relabelling a document's passages (KB-01),
// and matching, comparing and deleting passages (IN-07), because only the Python
// services touch Chroma.
import { config } from '../config'
import { labelUsageToWire, recordAiCalls } from './ai-usage.service'

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
// detail Unconfirmed.
export async function labelDocument(pdf: Buffer): Promise<LabelAnswer | null> {
  try {
    const response = await fetch(`${config.ingestionServiceUrl}/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(pdf),
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`/label answered ${response.status}`)
    const answer = (await response.json()) as LabelAnswer
    if (typeof answer?.details !== 'object' || answer.details === null) {
      throw new Error('/label answered without details')
    }
    await recordAiCalls(labelUsageToWire(answer.usage))
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
  kind: 'newer_edition' | 'earlier_edition' | 'possible_copy'
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

// Returns the aligned passages of a document and the one it matches (IN-07 AC7).
export async function getComparison(id: string, otherId: string): Promise<ComparisonRow[]> {
  const answer = await callIngestion<{ rows: ComparisonRow[] }>(
    `/documents/${id}/comparison/${otherId}`,
    'GET',
    'The comparison could not be loaded. Try again shortly.',
  )
  return answer.rows
}
