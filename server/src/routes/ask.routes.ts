// Questions about an assessment in the review workspace's Ask tab (AS-01),
// kept in conversations (AS-03), mounted at /api/assessments/:reference/ask.
// All need `reports:ask` (both roles, F-05) and an assessment the caller can
// open: its assigned engineer or a knowledge admin (403 otherwise). No session
// is a 401 (requireAuth). A conversation is its asker's alone: another user's
// answers 404, as one deleted does. On an archived assessment conversations
// are only read: asking and deleting answer 409 (AS-03 AC5).
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  answerQuestion,
  ConversationFullError,
  ConversationNotFoundError,
  deleteConversation,
  listConversations,
  openConversation,
  prepareQuestion,
  QuestionLimitError,
  type PreparedQuestion,
  questionSchema,
} from '../services/assessment-ask.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import { CannotOpenAssessmentError } from '../services/comment.service'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

type Params = { reference: string }
type ConversationParams = Params & { conversationId: string }

// The cause, when and the next step of a refusal, as the tab states it
// (AS-01 AC8): "Answer stopped at 14:02: <cause>. <next>"
const stated = (error: string, cause: string, next: string) => ({
  error,
  cause,
  next,
  at: new Date(),
})

// Answers a refused request with its status: 403 when the caller cannot open
// the assessment, 404 when there is none or the conversation is not theirs,
// 409 once it is archived or the conversation is full, 429 over the question
// limits. Rethrows anything else.
function refuse(error: unknown, res: Response) {
  if (error instanceof CannotOpenAssessmentError) {
    res.status(403).json({ error: error.message })
  } else if (error instanceof AssessmentNotFoundError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof ConversationNotFoundError) {
    res.status(404).json(stated(error.message, error.reason, error.next))
  } else if (error instanceof AssessmentArchivedError) {
    res
      .status(409)
      .json(
        stated(
          error.message,
          'the assessment is archived, so its conversations are read only',
          'Restore the assessment to ask about it again.',
        ),
      )
  } else if (error instanceof ConversationFullError) {
    res.status(409).json(stated(error.message, error.reason, error.next))
  } else if (error instanceof QuestionLimitError) {
    res.status(429).json(stated(error.reason, error.reason, error.next))
  } else {
    throw error
  }
}

// What the tab opens on (AS-03 AC2): the user's own conversations on the
// assessment, latest first, the latest with its questions, whether they are
// only read, and what a new question searches:
// `{ scope, archived, conversations, conversation, questions }`.
router.get('/', requirePermission('reports:ask'), async (req, res) => {
  try {
    res.json(await listConversations((req.params as Params).reference, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// One of the user's conversations with its questions: `{ conversation, questions }`.
router.get('/conversations/:conversationId', requirePermission('reports:ask'), async (req, res) => {
  const { reference, conversationId } = req.params as ConversationParams
  try {
    res.json(await openConversation(reference, res.locals.user!, conversationId))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Deletes one of the user's conversations for good (AS-03 AC2): 204.
router.delete(
  '/conversations/:conversationId',
  requirePermission('reports:ask'),
  async (req, res) => {
    const { reference, conversationId } = req.params as ConversationParams
    try {
      await deleteConversation(reference, res.locals.user!, conversationId)
      res.status(204).end()
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Asks one question: `{ question }`, or `{ question, passage }` about text
// selected in the draft (AS-02: its anchor, citations and findings), with
// `conversation` to go into one of the user's conversations; without it, the
// question starts a new one (AS-03). The answer streams as server-sent events
// (`question` with the conversation it is in, `step`, `statement`, `missing`,
// then `result` with the saved answer). One request per question and no
// polling (AS-01 AC8).
router.post('/', requirePermission('reports:ask'), async (req, res) => {
  const parsed = questionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'The question was not sent.', fields: fieldErrors(parsed.error) })
    return
  }
  let prepared: PreparedQuestion
  try {
    const reference = (req.params as Params).reference
    const { question, passage, conversation } = parsed.data
    prepared = await prepareQuestion(reference, res.locals.user!, question, passage, conversation)
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
    askedAt: prepared.saved.askedAt,
    conversation: prepared.conversation,
  })
  await answerQuestion(prepared, upstream.signal, send)
  res.end()
})

export default router
