// The gateway's side of the PDF check (IN-01): sends the PDF to the ingestion
// service's /inspect (app/api/routes.py), which opens it with PyMuPDF. Node has
// no PDF library; Python already has one.
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
