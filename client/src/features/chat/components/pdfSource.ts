// The PDF viewer's file source (CB-02): fetches the byte ranges pdf.js asks for itself, instead
// of letting pdf.js fetch them. Used by PdfViewer. Calls GET /api/knowledge-documents/:id/file,
// which answers Range requests (server/src/routes/knowledge-document.routes.ts).
// Why: Chrome makes requests for the same URL wait for each other on its HTTP cache ("cache
// lock"), so pdf.js's ~200 parallel ranges for a big standard ran one at a time (13 s for
// NFPA 25). Fetched with cache: 'no-store' they skip that cache and run in parallel. To still
// reopen fast, the fetched ranges are kept here in memory, per file.
import { pdfjs } from 'react-pdf'

type PdfTransport = InstanceType<typeof pdfjs.PDFDataRangeTransport>

// The first request reads the file's length (from Content-Range) and its first 64 KB, the
// size of pdf.js's own range chunks.
const FIRST_BYTES = 65536
// ponytail: whole files' fetched ranges stay in memory (about 15 MB for NFPA 25); the last 3
// files are kept. Move to IndexedDB if reopening after a reload ever matters.
const KEEP_FILES = 3

type FileCache = { length: number; first: ArrayBuffer; chunks: Map<string, Promise<ArrayBuffer>> }
const files = new Map<string, Promise<FileCache>>()

/** Returns the bytes [begin, end) of the file, and the file's total length. */
async function fetchRange(url: string, begin: number, end: number) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${begin}-${end - 1}` },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (response.status !== 206 && response.status !== 200)
    throw new Error(`The PDF couldn't be fetched (${response.status}).`)
  // A 200 (no range support) is the whole file: its length is the total.
  const total = response.headers.get('Content-Range')?.split('/')[1]
  const bytes = await response.arrayBuffer()
  return { bytes, total: total ? Number(total) : bytes.byteLength }
}

/** Returns the file's cached length, first bytes and ranges, fetching the first bytes once. */
function fileCache(url: string): Promise<FileCache> {
  const known = files.get(url)
  if (known) {
    // Most recently used goes last, so the oldest is dropped first.
    files.delete(url)
    files.set(url, known)
    return known
  }
  const loading = fetchRange(url, 0, FIRST_BYTES).then(({ bytes, total }) => ({
    length: total,
    first: bytes,
    chunks: new Map<string, Promise<ArrayBuffer>>(),
  }))
  // A failed fetch isn't kept, so the next open tries again.
  loading.catch(() => files.delete(url))
  files.set(url, loading)
  if (files.size > KEEP_FILES) files.delete(files.keys().next().value!)
  return loading
}

/** Returns a pdf.js source for the file that fetches only the byte ranges its pages need. */
export async function openPdfSource(url: string): Promise<PdfTransport> {
  const file = await fileCache(url)
  // pdf.js moves the bytes it is given to its worker, which empties them here: so it always
  // gets copies, and the cache keeps the originals.
  const source = new pdfjs.PDFDataRangeTransport(file.length, new Uint8Array(file.first.slice(0)))
  source.requestDataRange = (begin: number, end: number) => {
    const key = `${begin}-${end}`
    let chunk = file.chunks.get(key)
    if (!chunk) {
      chunk = fetchRange(url, begin, end).then((r) => r.bytes)
      chunk.catch(() => file.chunks.delete(key))
      file.chunks.set(key, chunk)
    }
    // ponytail: a failed range leaves that page loading; reopening the citation retries it.
    chunk.then(
      (bytes) => source.onDataRange(begin, new Uint8Array(bytes.slice(0))),
      () => {},
    )
  }
  return source
}
