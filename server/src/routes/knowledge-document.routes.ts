// The gateway's /api/knowledge-documents URLs (IN-01). Each route checks the
// request and picks the HTTP status; the work is in knowledge-document.service.ts.
import express, { Router, type ErrorRequestHandler } from 'express'
import { pipeline } from 'stream'
import { IngestionUnavailableError } from '../services/ingestion.service'
import {
  documentDetailsSchema,
  getKnowledgeDocumentFile,
  KnowledgeDocumentNotFoundError,
  listKnowledgeDocuments,
  RejectedFileError,
  uploadKnowledgeDocument,
} from '../services/knowledge-document.service'

const router = Router()

// Upload summary: every accepted document with its ingestion status.
router.get('/', async (_req, res) => {
  res.json(await listKnowledgeDocuments())
})

// Uploads one knowledge document (IN-01). The body is the PDF itself; its
// details are in the query string because they are not plain ASCII.
// Answers: 201 accepted · 400 bad details · 413 over 100 MB · 415 not a PDF ·
// 422 a PDF that will not open · 503 ingestion down (retry later).
router.post('/', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  const parsed = documentDetailsSchema.safeParse(req.query)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues)
      fields[issue.path.map(String).join('.')] ??= issue.message
    res.status(400).json({ error: 'The document details are invalid.', fields })
    return
  }
  try {
    res
      .status(201)
      .json(await uploadKnowledgeDocument(req.body, req.get('Content-Type') ?? '', parsed.data))
  } catch (error: unknown) {
    if (error instanceof RejectedFileError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if (error instanceof IngestionUnavailableError) {
      res.status(503).json({ error: error.message })
      return
    }
    throw error
  }
})

// Streams the original PDF from S3, inline so the browser opens it.
router.get('/:id/file', async (req, res) => {
  try {
    const file = await getKnowledgeDocumentFile(req.params.id)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    })
    // pipeline destroys the response if S3 fails mid-stream, rather than
    // leaving an unhandled stream error that would crash the gateway.
    pipeline(file.stream, res, (error) => {
      if (error) console.error('Streaming the original failed:', error.message)
    })
  } catch (error: unknown) {
    if (error instanceof KnowledgeDocumentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// express.raw rejects a body over the limit before the handler runs.
const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res.status(413).json({ error: 'The file is larger than 100 MB.' })
}
router.use(tooLarge)

export default router
