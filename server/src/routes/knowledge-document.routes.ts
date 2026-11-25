// The gateway's /api/knowledge-documents URLs (IN-01). Each route checks the
// request and picks the HTTP status; the work is in knowledge-document.service.ts.
import express, { Router, type ErrorRequestHandler } from 'express'
import { pipeline } from 'stream'
import { IngestionUnavailableError } from '../services/ingestion.service'
import { ConverterUnavailableError } from '../services/converter.service'
import {
  assertRequestOpen,
  GapRequestClosedError,
  GapRequestNotFoundError,
  recordIncomingDocument,
} from '../services/knowledge-gap.service'
import type { z } from 'zod'
import { isTierId } from '../services/source-tiers'
import {
  correctKnowledgeDocument,
  cancelIngestion,
  chooseSourceType,
  sourceTypeChoiceSchema,
  documentDetailsSchema,
  getKnowledgeDocument,
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
import {
  listKnowledgeDocumentPassages,
  passageQuerySchema,
} from '../services/knowledge-passages.service'
import {
  addManualSection,
  changeManualSection,
  ClauseExistsError,
  createManualDocument,
  deleteManualSection,
  listManualSections,
  ManualEntryExistsError,
  manualDocumentSchema,
  ManualSectionInvalidError,
  manualSectionChangeSchema,
  manualSectionSchema,
  reembedManualSection,
  addScreenshot,
  getScreenshot,
  publishManualDocument,
  PublishBlockedError,
  screenshotQuerySchema,
  startFromSchema,
} from '../services/manual-section.service'
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

// One document, as the list shows it (F-10). Answers: 200 · 404 unknown. After
// /ingested, or that would be read as an id.
router.get('/:id', requirePermission('knowledge:view'), async (req, res) => {
  try {
    res.json(await getKnowledgeDocument(req.params.id))
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
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
    const { fileName, requestId } = parsed.data
    try {
      // Uploaded for a knowledge request (F-11): refused before the upload when
      // the request is unknown (404) or closed (409).
      if (requestId) await assertRequestOpen(requestId)
      const document = await uploadKnowledgeDocument(req.body, fileName)
      if (requestId) await recordIncomingDocument(requestId, document.id)
      res.status(201).json(document)
    } catch (error: unknown) {
      if (error instanceof GapRequestNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof GapRequestClosedError) {
        res.status(409).json({ error: error.message })
        return
      }
      if (error instanceof RejectedFileError) {
        res.status(error.status).json({ error: error.message })
        return
      }
      if (
        error instanceof IngestionUnavailableError ||
        error instanceof ConverterUnavailableError
      ) {
        res.status(503).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

// Starts a standard entered clause by clause, for one with no PDF (IN-18): a
// draft with these details, no file and nothing queued. The body is a
// standard's details, as JSON. Answers: 201 created · 400 bad details, or not a
// standard, or a `copyFrom` that isn't another edition of it · 409 a manual entry of this
// standard and edition exists (names it) · 503 the edition to copy couldn't be read.
// With `copyFrom` ("Start from"), the draft starts with that edition's clauses, unchecked.
router.post('/manual', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = manualDocumentSchema.safeParse(req.body)
  const start = startFromSchema.safeParse(req.body)
  if (!parsed.success || !start.success) {
    res.status(400).json(invalidDetails((parsed.error ?? start.error)!))
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.status(201).json(await createManualDocument(parsed.data, { id, name }, start.data.copyFrom))
  } catch (error: unknown) {
    if (error instanceof ManualEntryExistsError) {
      res.status(409).json({ error: error.message, documentId: error.documentId })
      return
    }
    answerClause(error, res)
  }
})

// A manual document's clauses (IN-18). Saving indexes the clause at once; if
// ingestion is down the clause is still saved, with `indexed: false`, and
// Re-embed tries again. Every change answers 409 for an uploaded document
// (its passages are read-only) or a withdrawn one.
function answerClause(error: unknown, res: express.Response) {
  if (error instanceof ClauseExistsError) {
    res.status(409).json({ error: error.message, fields: { clause: error.message } })
    return
  }
  if (error instanceof ManualSectionInvalidError) {
    res.status(400).json({ error: error.message, fields: { [error.field]: error.message } })
    return
  }
  answerStateChange(error, res)
}

// Lists the clauses in their order. Answers: 200 · 404 unknown · 409 an uploaded document.
router.get('/:id/sections', requirePermission('knowledge:view'), async (req, res) => {
  try {
    res.json(await listManualSections(req.params.id))
  } catch (error: unknown) {
    answerClause(error, res)
  }
})

// Adds a clause. Answers: 201 · 400 bad clause · 404 · 409 clause number taken, or not editable.
router.post('/:id/sections', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = manualSectionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json(invalidDetails(parsed.error))
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.status(201).json(await addManualSection(req.params.id, parsed.data, { id, name }))
  } catch (error: unknown) {
    answerClause(error, res)
  }
})

// Saves a change, with the `updatedAt` it was loaded with. Answers: 200 · 400 · 404 · 409
// clause number taken, someone else saved it meanwhile, or not editable.
router.put('/:id/sections/:sid', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = manualSectionChangeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json(invalidDetails(parsed.error))
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.json(await changeManualSection(req.params.id, req.params.sid, parsed.data, { id, name }))
  } catch (error: unknown) {
    answerClause(error, res)
  }
})

// Deletes a clause. Answers: 204 · 404 · 409 a report cites it, or not editable · 503 its
// passages couldn't be removed from search (the clause is kept).
router.delete('/:id/sections/:sid', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    await deleteManualSection(req.params.id, req.params.sid)
    res.status(204).end()
  } catch (error: unknown) {
    answerClause(error, res)
  }
})

// Publishes a manual draft (IN-18): its clauses become searchable, or Needs review if
// it matches another document, such as its own PDF. Answers: 200 the document · 404 ·
// 409 not a manual draft, or not finished (`unindexed`, `unchecked` say how many
// clauses are left) · 503 the match couldn't run (still a draft).
router.post('/:id/publish', requirePermission('knowledge:manage'), async (req, res) => {
  try {
    res.json(await publishManualDocument(req.params.id))
  } catch (error: unknown) {
    if (error instanceof PublishBlockedError) {
      const { message, unindexed, unchecked } = error
      res.status(409).json({ error: message, unindexed, unchecked })
      return
    }
    answerClause(error, res)
  }
})

// Reads a screenshot of a table, formula or picture with OCR and stores it, for a
// clause to hold once saved. The body is the image; `kind` and the clause's heading
// trail (`context`) are in the query. Answers: 201 `{ key, kind, text, readError }`
// (text '' with a reason when OCR read nothing) · 400 no kind · 404 · 409 not
// editable · 413 over 10 MB · 415 not a PNG, JPG or WebP · 422 an image that won't open.
router.post(
  '/:id/sections/screenshots',
  requirePermission('knowledge:manage'),
  express.raw({ type: '*/*', limit: '10mb' }),
  async (req, res) => {
    const parsed = screenshotQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json(invalidDetails(parsed.error))
      return
    }
    try {
      const image = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      res.status(201).json(await addScreenshot(req.params.id, image, parsed.data))
    } catch (error: unknown) {
      if (error instanceof RejectedFileError) {
        res.status(error.status).json({ error: error.message })
        return
      }
      answerClause(error, res)
    }
  },
)

// Streams a screenshot a clause holds, to anyone who can view (the citation view shows it).
// Answers: 200 the image · 404 not one a clause of this document holds.
router.get(
  '/:id/sections/screenshots/:name',
  requirePermission('knowledge:view'),
  async (req, res) => {
    try {
      const shot = await getScreenshot(req.params.id, req.params.name)
      res.set({ 'Content-Type': shot.contentType, 'Cache-Control': 'private, max-age=86400' })
      pipeline(await shot.open(), res, () => undefined)
    } catch (error: unknown) {
      answerClause(error, res)
    }
  },
)

// Indexes a clause again as saved. Answers: 200 (`indexed` says whether it worked) · 404 · 409.
router.post(
  '/:id/sections/:sid/reembed',
  requirePermission('knowledge:manage'),
  async (req, res) => {
    try {
      res.json(await reembedManualSection(req.params.id, req.params.sid))
    } catch (error: unknown) {
      answerClause(error, res)
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
    // The tier rides beside the details (RT-04); the details schema would strip it.
    const tier = req.body?.tier
    if (tier !== undefined && !isTierId(tier)) {
      res.status(400).json({ error: 'Choose a tier from the list.' })
      return
    }
    res.json(await correctKnowledgeDocument(req.params.id, parsed.data, { id, name }, tier))
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
    const { id, name } = res.locals.user!
    await cancelIngestion(req.params.id, { id, name })
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
    const { id, name } = res.locals.user!
    await retryIngestion(req.params.id, { id, name })
    res.status(202).end()
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// Chooses the source type of a document labelling couldn't type, and queues
// its ingestion (IN-19). Answers: 200 the document, queued · 400 a type not on
// the list · 404 unknown · 409 not awaiting a type · 503 the queue could not be
// reached (still awaiting a type).
router.post('/:id/source-type', requirePermission('knowledge:manage'), async (req, res) => {
  const parsed = sourceTypeChoiceSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  try {
    const { id, name } = res.locals.user!
    res.json(await chooseSourceType(req.params.id, parsed.data.sourceType, { id, name }))
  } catch (error: unknown) {
    answerStateChange(error, res)
  }
})

// One page of a document's passages with its outline, for the knowledge base browser
// (IN-17): `offset`, `limit`, the outline's `chapter` and `section`, `pageFrom`/`pageTo`,
// and `q` to search by words or, with `mode=meaning`, by meaning. Answers: 200
// `{ total, passages, outline }` · 400 a value that can't be used · 404 unknown · 409 a
// search of a document that isn't active · 503 a service is down, or the query couldn't
// be protected.
router.get('/:id/passages', requirePermission('knowledge:view'), async (req, res) => {
  const parsed = passageQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  try {
    res.json(await listKnowledgeDocumentPassages(req.params.id, parsed.data, res.locals.user!.id))
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
  // The route's own limit: 100 MB for a document, 10 MB for a screenshot (IN-18).
  const mb = typeof error.limit === 'number' ? Math.round(error.limit / 1024 / 1024) : 100
  res.status(413).json({ error: `The file is larger than ${mb} MB.` })
}
router.use(tooLarge)

export default router
