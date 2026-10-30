// The knowledge assistant's chat endpoint (CB-01). Passes the chat screen's
// request to S4 and streams S4's answer events (AG-UI, as server-sent events)
// back unchanged, apart from the usage event at the end, which the service
// records and removes (EV-03). Called by client/src/features/chat/api.ts.
import { randomUUID } from 'node:crypto'
import { Router, type Request, type RequestHandler, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { requirePermission } from '../middleware/auth.middleware'
import { ChatError } from '../services/chat-error'
import { checkChatLimits } from '../services/chat-limits.service'
import { chatSaveTap, lastQuestion, saveQuestion } from '../services/chat-save.service'
import { chatUsageTap } from '../services/chat-usage.service'
import {
  addFact,
  deleteFact,
  editFact,
  getMemory,
  setMemoryEnabled,
  withChatMemory,
} from '../services/chat-memory.service'
import {
  createConversation,
  deleteConversation,
  getMessages,
  ownedConversation,
  listConversations,
  renameConversation,
  switchVersion,
} from '../services/chat-conversation.service'
import {
  getPassage,
  openChatStream,
  RagServiceError,
  withChatDocuments,
} from '../services/rag.service'

const router = Router()

// Answers a ChatError with its status and message (404 missing or not yours, 400 bad input, 409 full
// list); anything else is a real error and is rethrown.
function chatError(res: Response, error: unknown) {
  if (error instanceof ChatError) return res.status(error.status).json({ error: error.message })
  throw error
}
type Params = Record<string, string>
// Runs a handler and answers its ChatError, so each handler holds only its own work.
const handle =
  (fn: (req: Request<Params>, res: Response) => Promise<void>): RequestHandler<Params> =>
  async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      chatError(res, error)
    }
  }

// Everything the engineer wrote in the request: every user message and context
// entry. Checking only the last message would let a blank last message hide a
// huge earlier one, which S4 would still send to the models.
function engineerTexts(body: unknown): string[] {
  const { messages, context } = (body ?? {}) as {
    messages?: { role?: string; content?: unknown }[]
    context?: { value?: unknown }[]
  }
  const said = Array.isArray(messages)
    ? messages.filter((m) => m?.role === 'user').map((m) => m.content)
    : []
  const noted = Array.isArray(context) ? context.map((c) => c?.value) : []
  return [...said, ...noted].filter((t): t is string => typeof t === 'string')
}

// Sends the refusal as a short answer in the same event stream S4 uses. Must
// match the events in microservices/rag-service/app/chat/answer.py.
function refuse(res: Response, reason: string) {
  const id = randomUUID()
  const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`
  const program = `root = Answer([s1])\ns1 = Statement(${JSON.stringify(reason)}, [])\n`
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.end(
    event({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }) +
      event({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: program }) +
      event({ type: 'TEXT_MESSAGE_END', messageId: id }),
  )
}

router.post('/', requirePermission('knowledge:view'), async (req, res) => {
  // Refused here, before S4, so no model is called and nothing is spent. It is a
  // 200 stream, not a 429, because OpenUI's fetchLLM would show a generic error
  // for a 429 instead of the reason.
  const userId = res.locals.user!.id
  // a. A chat named by threadId must be the user's own; checked first so nothing is spent or saved otherwise.
  const threadId: unknown = req.body?.threadId
  if (typeof threadId === 'string') {
    try {
      await ownedConversation(userId, threadId)
    } catch (error) {
      return chatError(res, error)
    }
  }
  const reason = checkChatLimits(userId, engineerTexts(req.body))
  if (reason) {
    refuse(res, reason)
    return
  }
  // b. Save the question before asking S4, so it is kept even if the answer fails.
  const question = lastQuestion(req.body)
  // A failed save is logged, not fatal: the engineer still gets their answer.
  const questionId =
    typeof threadId === 'string' && question
      ? await saveQuestion(threadId, userId, question).catch((error) => {
          console.error('Could not save the chat question:', error)
          return null
        })
      : null
  // Without this, S4 keeps writing an answer after the engineer presses stop.
  const upstream = new AbortController()
  res.on('close', () => upstream.abort())
  let stream: ReadableStream<Uint8Array>
  try {
    stream = await openChatStream(
      await withChatDocuments(await withChatMemory(req.body, userId)),
      upstream.signal,
      userId,
    )
  } catch (error: unknown) {
    if (error instanceof RagServiceError) {
      res.status(503).json({ error: error.message })
      return
    }
    throw error
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  // A stop mid-answer ends the stream with an abort error; without the catch,
  // that unhandled rejection would crash the gateway.
  await pipeline(
    Readable.fromWeb(stream as WebReadableStream<Uint8Array>),
    chatUsageTap(userId),
    ...(typeof threadId === 'string' ? [chatSaveTap(threadId, userId, questionId)] : []),
    res,
  ).catch(() => {})
})

// "My preferences" (CB-05): the engineer's own facts and the memory switch.
const memory = Router()
memory.get('/', async (_req, res) => {
  res.json(await getMemory(res.locals.user!.id))
})
memory.patch(
  '/',
  handle(async (req, res) => {
    res.json(await setMemoryEnabled(res.locals.user!.id, req.body?.enabled))
  }),
)
memory.post(
  '/facts',
  handle(async (req, res) => {
    res.status(201).json(await addFact(res.locals.user!.id, req.body?.text))
  }),
)
memory.patch(
  '/facts/:id',
  handle(async (req, res) => {
    res.json(await editFact(res.locals.user!.id, req.params.id, req.body?.text))
  }),
)
memory.delete(
  '/facts/:id',
  handle(async (req, res) => {
    await deleteFact(res.locals.user!.id, req.params.id)
    res.status(204).end()
  }),
)
router.use('/memory', requirePermission('knowledge:view'), memory)

// Saved chats (CB-03). OpenUI's thread storage calls these (client/src/features/chat/api.ts).
const mine = (res: Response) => res.locals.user!.id as string
const chats = Router()
chats.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined
  res.json({ threads: await listConversations(mine(res), q) })
})
chats.post('/', async (req, res) => {
  const content = req.body?.message?.content
  res
    .status(201)
    .json(await createConversation(mine(res), typeof content === 'string' ? content : ''))
})
chats.get(
  '/:id',
  handle(async (req, res) => {
    res.json(await getMessages(mine(res), req.params.id))
  }),
)
// Switches the chat to another version (CB-04): `messageId` is one of its messages.
chats.patch(
  '/:id/active',
  handle(async (req, res) => {
    res.json(await switchVersion(mine(res), req.params.id, req.body?.messageId))
  }),
)
chats.patch(
  '/:id',
  handle(async (req, res) => {
    res.json(await renameConversation(mine(res), req.params.id, req.body?.title))
  }),
)
chats.delete(
  '/:id',
  handle(async (req, res) => {
    await deleteConversation(mine(res), req.params.id)
    res.status(204).end()
  }),
)
router.use('/conversations', requirePermission('knowledge:view'), chats)

// One passage behind a citation (CB-02): its text and page boxes, passed through from S4.
router.get('/passages/:id', requirePermission('knowledge:view'), async (req, res) => {
  try {
    res.json(await getPassage(req.params.id))
  } catch (error: unknown) {
    if (!(error instanceof RagServiceError)) throw error
    // 404 means S4 doesn't know the id; anything else (down, failed) is 503.
    if (error.status === 404) res.status(404).json({ error: error.message })
    else res.status(503).json({ error: error.message })
  }
})

export default router
