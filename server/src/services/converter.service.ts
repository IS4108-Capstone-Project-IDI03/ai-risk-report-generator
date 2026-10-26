// The gateway's call to the converter (Gotenberg: LibreOffice behind HTTP),
// which turns an uploaded Word, PowerPoint, RTF or ODT file into a PDF. Every stage
// after upload reads PDF pages: the ingestion pipeline's page batches and OCR
// crops, labelling, and the chat's page citations (CB-02).
import { config } from '../config'

// Converts `file` to PDF. `extension` names its real type (from its bytes, not
// its name), since the converter picks how to read a file by its extension.
// Returns null when the converter cannot read the file: Gotenberg answers a
// corrupt file with a 500 (its text blames memory, but the file is the cause).
export async function toPdf(file: Buffer, extension: string): Promise<Buffer | null> {
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(file)]), `upload.${extension}`)
  const response = await fetch(`${config.converterServiceUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) return null
  return Buffer.from(await response.arrayBuffer())
}
