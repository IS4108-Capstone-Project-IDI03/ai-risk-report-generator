// Questions about an assessment in the review workspace's Ask tab (AS-01),
// mounted at /api/assessments/:reference/ask. Both need `reports:ask` (both
// roles, F-05) and an assessment the caller can open: its assigned engineer or
// a knowledge admin (403 otherwise). No session is a 401 (requireAuth).
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  answerQuestion,
  listQuestions,
  prepareQuestion,
  QuestionLimitError,
  type PreparedQuestion,
  questionSchema,
} from '../services/assessment-ask.service'
import { AssessmentNotFoundError } from '../services/capture-session.service'
import { CannotOpenAssessmentError } from '../services/comment.service'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

type Params = { reference: string }

// Answers a refused request with its status: 403 when the caller cannot open
// the assessment, 404 when there is none, 429 over the question limits (with
// the cause, when, and the next step, AC8). Rethrows anything else.
function refuse(error: unknown, res: Response) {
  if (error instanceof CannotOpenAssessmentError) {
    res.status(403).json({ error: error.message })
  } else if (error instanceof AssessmentNotFoundError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof QuestionLimitError) {
    res
      .status(429)
      .json({ error: error.reason, cause: error.reason, next: error.next, at: new Date() })
  } else {
    throw error
  }
}

// The user's own questions on the assessment, oldest first, and what a new
// one searches: `{ scope, questions }`.
router.get('/', requirePermission('reports:ask'), async (req, res) => {
  try {
    res.json(await listQuestions((req.params as Params).reference, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Asks one question: `{ question }`. The answer streams as server-sent
// events (`step`, `statement`, `missing`, then `result` with the saved
// answer). One request per question and no polling (AC8).
router.post('/', requirePermission('reports:ask'), async (req, res) => {
  const parsed = questionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'The question was not sent.', fields: fieldErrors(parsed.error) })
    return
  }
  let prepared: PreparedQuestion
  try {
    const reference = (req.params as Params).reference
    prepared = await prepareQuestion(reference, res.locals.user!, parsed.data.question)
  } catch (error: unknown) {
    refuse(error, res)
    return
  }
  // Without this, S4 keeps writing an answer after the engineer leaves.
  const upstream = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) upstream.abort()
  })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const send = (event: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  send({
    type: 'question',
    id: String(prepared.saved._id),
    question: prepared.saved.question,
    askedAt: prepared.saved.createdAt,
  })
  await answerQuestion(prepared, upstream.signal, send)
  res.end()
})

export default router
