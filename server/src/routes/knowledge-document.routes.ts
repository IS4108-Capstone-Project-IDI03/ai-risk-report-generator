// The gateway's /api/knowledge-documents URLs (IN-01). Each route checks the
// request and picks the HTTP status; the work is in knowledge-document.service.ts.
import express, { Router, type ErrorRequestHandler } from 'express'
import { pipeline } from 'stream'
import { IngestionUnavailableError } from '../services/ingestion.service'
import type { z } from 'zod'
import {
  correctKnowledgeDocument,
  documentDetailsSchema,
  getKnowledgeDocumentFile,
  KnowledgeDocumentWrongStateError,
  KnowledgeDocumentNotFoundError,
  listIngestedDocuments,
  listKnowledgeDocuments,
  reinstateKnowledgeDocument,
  RejectedFileError,
  uploadDetailsSchema,
  uploadKnowledgeDocument,
  withdrawKnowledgeDocument,
} from '../services/knowledge-document.service'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// A 400 body naming each field to fix, with its first problem.
function invalidDetails(error: z.ZodError) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) fields[issue.path.map(String).join('.')] ??= issue.message
  return { error: 'The document details are invalid.', fields }
}

// Upload summary: every accepted document with its ingestion status.
router.get('/', requirePermission('knowledge:view'), async (_req, res) => {
  res.json(await listKnowledgeDocuments())
})

// The knowledge base: every ingested document, active or withdrawn, by title (KB-01).
router.get('/ingested', requirePermission('knowledge:view'), async (_req, res) => {
  res.json(await listIngestedDocuments())
})

// Uploads one knowledge document (IN-01). The body is the PDF itself; its
// details are in the query string because they are not plain ASCII.
// Answers: 201 accepted · 400 bad details · 413 over 100 MB · 415 not a PDF ·
// 422 a PDF that will not open · 503 ingestion down (retry later).
router.post(
  '/',
  requirePermission('knowledge:manage'),
  express.raw({ type: '*/*', limit: '100mb' }),
  async (req, res) => {
    const parsed = uploadDetailsSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json(invalidDetails(parsed.error))
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
  },
)

// Corrects a document's details (KB-01). The body is the full set of details,
// as JSON. Answers: 200 corrected · 400 bad details · 404 unknown · 409 not
// active · 503 search could not be updated (old details kept).
router.put('/:id', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = documentDetailsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json(invalidDetails(parsed.error))
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.json(await correctKnowledgeDocument(req.params.id, parsed.data, { id, name }))
  } catch (error: unknown) {
    const status =
      error instanceof KnowledgeDocumentNotFoundError
        ? 404
        : error instanceof KnowledgeDocumentWrongStateError
          ? 409
          : error instanceof IngestionUnavailableError
            ? 503
            : null
    if (!status || !(error instanceof Error)) throw error
    res.status(status).json({ error: error.message })
  }
})

// Maps a failed withdraw or reinstate to its HTTP status; rethrows the rest.
function answerStateChange(error: unknown, res: express.Response) {
  const status =
    error instanceof KnowledgeDocumentNotFoundError
      ? 404
      : error instanceof KnowledgeDocumentWrongStateError
        ? 409
        : error instanceof IngestionUnavailableError
          ? 503
          : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

// Withdraws a document from use (KB-01). Answers: 200 withdrawn · 404 unknown
// · 409 not active · 503 search could not be updated (still active).
router.post('/:id/withdraw', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    const { id, name } = res.locals.user!
    res.json(await withdrawKnowledgeDocument(req.params.id, { id, name }))
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Reinstates a withdrawn document (KB-01). Answers: 200 reinstated · 404
// unknown · 409 not withdrawn · 503 search could not be updated (still withdrawn).
router.post('/:id/reinstate', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    res.json(await reinstateKnowledgeDocument(req.params.id))
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Streams the original PDF from S3, inline so the browser opens it.
router.get('/:id/file', requirePermission('knowledge:view'), async (req, res) => {
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
