import { config } from '../config'

// Ingestion (its service or its queue) is down; the upload can be retried.
export class IngestionUnavailableError extends Error {
  constructor(message = 'The ingestion service could not check the file. Try again shortly.') {
    super(message)
    this.name = 'IngestionUnavailableError'
  }
}

// Asks the ingestion service to open the PDF (PyMuPDF), since the gateway
// cannot. Returns why it cannot be opened, or null when it opens fine.
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
