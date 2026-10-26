// The gateway's call to the converter (Gotenberg: LibreOffice behind HTTP),
// which turns an uploaded Word, PowerPoint, RTF or ODT file into a PDF. Every stage
// after upload reads PDF pages: the ingestion pipeline's page batches and OCR
// crops, labelling, and the chat's page citations (CB-02).
import { config } from '../config'

// The converter is down, busy or too slow; the upload can be retried.
export class ConverterUnavailableError extends Error {
  constructor(message = 'The file could not be converted just now. Try again shortly.') {
    super(message)
    this.name = 'ConverterUnavailableError'
  }
}

// Just over Gotenberg's own --api-timeout (120 s, docker-compose.yml), so its
// answer arrives first; this only cuts off a converter that hangs.
const CONVERT_TIMEOUT_MS = 130_000

// Converts `file` to PDF. `extension` names its real type (from its bytes, not
// its name), since the converter picks how to read a file by its extension.
// Returns null when the converter cannot read the file: Gotenberg answers a
// corrupt file with a 500 (its text blames memory, but the file is the cause).
// Throws ConverterUnavailableError if it is down, times out or answers 503
// (busy, or past its own time limit), which becomes a 503.
export async function toPdf(file: Buffer, extension: string): Promise<Buffer | null> {
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(file)]), `upload.${extension}`)
  let response: Response
  try {
    response = await fetch(`${config.converterServiceUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    })
  } catch {
    throw new ConverterUnavailableError()
  }
  if (response.status === 503) throw new ConverterUnavailableError()
  if (!response.ok) return null
  return Buffer.from(await response.arrayBuffer())
}
