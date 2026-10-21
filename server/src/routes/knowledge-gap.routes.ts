// The gateway's /api/knowledge-gaps URLs (CB-07). Each route checks the request
// and picks the HTTP status; the work is in knowledge-gap.service.ts.
import { Router, type Response } from 'express'
import type { ZodType } from 'zod'
import { requirePermission } from '../middleware/auth.middleware'
import {
  createRequest,
  createRequestSchema,
  dismissRequest,
  dismissRequestSchema,
  fillRequest,
  fillRequestSchema,
  GapRequestClosedError,
  GapRequestInvalidError,
  GapRequestNotFoundError,
  listOpenRequests,
} from '../services/knowledge-gap.service'
import { fieldErrors } from './field-errors'

const router = Router()

// Parses the body, or answers 400 with the fields to fix and returns null.
function parseBody<T>(schema: ZodType<T>, body: unknown, res: Response): T | null {
  const parsed = schema.safeParse(body)
  if (parsed.success) return parsed.data
  res.status(400).json({ error: 'The request is invalid.', fields: fieldErrors(parsed.error) })
  return null
}

// Maps a failed fill or dismiss to its status; rethrows anything else.
function answerError(error: unknown, res: Response) {
  if (error instanceof GapRequestInvalidError) {
    res.status(400).json({ error: error.message, fields: error.fields })
  } else if (error instanceof GapRequestNotFoundError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof GapRequestClosedError) {
    res.status(409).json({ error: error.message })
  } else throw error
}

// An engineer sends a request. Answers: 201 saved · 400 bad body · 403 not an engineer.
router.post('/', requirePermission('knowledge:view'), async (req, res) => {
  const user = res.locals.user!
  if (user.role !== 'risk_engineer') {
    res.status(403).json({ error: 'Your role does not allow this.' })
    return
  }
  const body = parseBody(createRequestSchema, req.body, res)
  if (body) res.status(201).json(await createRequest(body, user))
})

// The admin's open requests, newest first.
router.get('/', requirePermission('knowledge:manage'), async (_req, res) => {
  res.json({ requests: await listOpenRequests() })
})

// Answers: 200 filled · 400 bad body or unknown document · 404 unknown · 409 already closed.
router.post('/:id/fill', requirePermission('knowledge:manage'), async (req, res) => {
  const body = parseBody(fillRequestSchema, req.body, res)
  if (!body) return
  try {
    res.json(await fillRequest(req.params.id, body.documentIds, res.locals.user!))
  } catch (error) {
    answerError(error, res)
  }
})

// Answers: 200 dismissed · 400 no reason · 404 unknown · 409 already closed.
router.post('/:id/dismiss', requirePermission('knowledge:manage'), async (req, res) => {
  const body = parseBody(dismissRequestSchema, req.body, res)
  if (!body) return
  try {
    res.json(await dismissRequest(req.params.id, body.reason, res.locals.user!))
  } catch (error) {
    answerError(error, res)
  }
})

export default router
