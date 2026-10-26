// The gateway's /api/knowledge-documents URLs (IN-01). Each route checks the
// request and picks the HTTP status; the work is in knowledge-document.service.ts.
import express, { Router, type ErrorRequestHandler } from 'express'
import { pipeline } from 'stream'
import { IngestionUnavailableError } from '../services/ingestion.service'
import type { z } from 'zod'
import {
  correctKnowledgeDocument,
  cancelIngestion,
  documentDetailsSchema,
  getKnowledgeDocumentFile,
  byteRange,
  KnowledgeDocumentWrongStateError,
  KnowledgeDocumentNotFoundError,
  listIngestedDocuments,
  listKnowledgeDocuments,
  reinstateKnowledgeDocument,
  RejectedFileError,
  uploadQuerySchema,
  retryIngestion,
  uploadKnowledgeDocument,
  withdrawKnowledgeDocument,
} from '../services/knowledge-document.service'
import {
  compareKnowledgeDocument,
  decideKnowledgeDocument,
  decisionSchema,
  deleteKnowledgeDocument,
} from '../services/knowledge-document-decision.service'
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

// Uploads one knowledge document (IN-01, IN-05). The body is the file itself: a
// PDF, or a Word, PowerPoint, RTF or ODT file, which is converted to one (its
// Content-Type is ignored; the type is read from its bytes). Its name is in the
// query string because it is not plain ASCII; every other detail is read from
// the file. Answers: 201 accepted · 400 no file name · 413 over 100 MB · 415 not
// a type that can be uploaded · 409 an identical file is stored · 422 a PDF that
// will not open, or a file that will not convert · 503 ingestion down (retry later).
router.post(
  '/',
  requirePermission('knowledge:manage'),
  express.raw({ type: '*/*', limit: '100mb' }),
  async (req, res) => {
    const parsed = uploadQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json(invalidDetails(parsed.error))
      return
    }
    try {
      res.status(201).json(await uploadKnowledgeDocument(req.body, parsed.data.fileName))
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

// Maps a failed withdraw, reinstate, comparison or decision to its HTTP status; rethrows the rest.
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

// Stops a queued or processing ingestion. Answers: 202 accepted · 404 unknown
// · 409 already terminal. An active worker observes the cancellation marker
// and performs cleanup before marking the document cancelled.
router.post('/:id/cancel', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    await cancelIngestion(req.params.id)
    res.status(202).end()
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Retries a failed ingestion without re-uploading (the PDF and details are
// kept). Answers: 202 accepted (re-queued) · 404 unknown · 409 not failed ·
// 503 the queue could not be reached (left failed). Same error mapping as the
// state changes above.
router.post('/:id/retry', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    await retryIngestion(req.params.id)
    res.status(202).end()
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// The reviewed document beside the one it matches, passages aligned (IN-07).
// Answers: 200 · 404 unknown · 409 no match to compare · 503 ingestion down.
router.get('/:id/comparison', requirePermission('knowledge:view'), async (req, res) => {
  try {
    res.json(await compareKnowledgeDocument(req.params.id))
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Applies the admin's decision on a match (IN-07). The body is `{ choice }`.
// Answers: 200 `{ document }` (null once discarded) · 400 unknown choice · 404
// unknown · 409 details Unconfirmed, no match or a choice that does not fit ·
// 503 the knowledge base could not be updated (nothing changed).
router.post('/:id/decision', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.json({
      document: await decideKnowledgeDocument(req.params.id, parsed.data.choice, { id, name }),
    })
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Permanently deletes a document uploaded by mistake (IN-12). Answers: 204
// deleted · 404 unknown · 409 still being ingested, or a report cites it ·
// 503 the knowledge base could not be updated (nothing changed, retry).
router.delete('/:id', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    await deleteKnowledgeDocument(req.params.id)
    res.status(204).end()
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Streams the original PDF from S3, inline so the browser opens it. CB-02: a document's file
// never changes under its id, so the signed-in user's browser may keep it for a day
// (`private`: never a shared cache, the file needs a login). And it answers a Range request
// with just those bytes, so pdf.js draws a page of an 86 MB standard without the whole file.
router.get('/:id/file', requirePermission('knowledge:view'), async (req, res) => {
  try {
    const file = await getKnowledgeDocumentFile(req.params.id)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, max-age=86400, immutable',
      'Accept-Ranges': 'bytes',
      // The file's fingerprint: Chrome only keeps fetched byte ranges that carry one.
      ETag: `"${file.sha256}"`,
    })
    const range = byteRange(req.headers.range, file.size)
    if (range === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${file.size}`).end()
      return
    }
    const [first, last] = range ?? [0, file.size - 1]
    if (range) res.status(206).set('Content-Range', `bytes ${first}-${last}/${file.size}`)
    res.set('Content-Length', String(last - first + 1))
    // pipeline destroys the response if S3 fails mid-stream, rather than
    // leaving an unhandled stream error that would crash the gateway.
    pipeline(await file.open(range ?? undefined), res, (error) => {
      // pdf.js cancels its first full request once it learns ranges work: not a failure.
      if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE')
        console.error('Streaming the original failed:', error.message)
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
