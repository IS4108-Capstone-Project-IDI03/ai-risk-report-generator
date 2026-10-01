// The gateway's calls to the ingestion service (app/api/routes.py): the PDF
// check (IN-01), which opens the file with PyMuPDF because Node has no PDF
// library, and relabelling a corrected document's passages (KB-01), because
// only the Python services write to Chroma.
import { config } from '../config'

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

// Puts a corrected document's labels on all its passages in Chroma (KB-01).
// Throws IngestionUnavailableError if the service is down or refuses, so the
// caller can keep the old details.
export async function relabelPassages(id: string, labels: object): Promise<void> {
  const failed = new IngestionUnavailableError(
    'Search could not be updated, so the correction was not saved. Try again shortly.',
  )
  const response = await fetch(`${config.ingestionServiceUrl}/documents/${id}/labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(labels),
  }).catch(() => {
    throw failed
  })
  if (!response.ok) throw failed
}
