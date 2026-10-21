// The knowledge assistant's chat endpoint (CB-01). Passes the chat screen's
// request to S4 and streams S4's answer events (AG-UI, as server-sent events)
// back unchanged, apart from the usage event at the end, which the service
// records and removes (EV-03). Called by client/src/features/chat/api.ts.
import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { requirePermission } from '../middleware/auth.middleware'
import { checkChatLimits } from '../services/chat-limits.service'
import { chatSaveTap, lastQuestion, saveQuestion } from '../services/chat-save.service'
import { chatUsageTap } from '../services/chat-usage.service'
import {
  ConversationNotFound,
  createConversation,
  deleteConversation,
  getMessages,
  InvalidTitle,
  ownedConversation,
  listConversations,
  renameConversation,
} from '../services/chat-conversation.service'
import {
  getPassage,
  openChatStream,
  RagServiceError,
  withChatDocuments,
} from '../services/rag.service'

const router = Router()

// Answers a missing or someone else's chat with 404 and a bad name with 400; anything else is a real error.
function conversationError(res: Response, error: unknown) {
  if (error instanceof ConversationNotFound)
    return res.status(404).json({ error: 'Chat not found.' })
  if (error instanceof InvalidTitle) return res.status(400).json({ error: 'A chat needs a name.' })
  throw error
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
      return conversationError(res, error)
    }
  }
  const reason = checkChatLimits(userId, engineerTexts(req.body))
  if (reason) {
    refuse(res, reason)
    return
  }
  // b. Save the question before asking S4, so it is kept even if the answer fails.
  const question = lastQuestion(req.body)
  if (typeof threadId === 'string' && question) await saveQuestion(threadId, userId, question)
  // Without this, S4 keeps writing an answer after the engineer presses stop.
  const upstream = new AbortController()
  res.on('close', () => upstream.abort())
  let stream: ReadableStream<Uint8Array>
  try {
    stream = await openChatStream(await withChatDocuments(req.body), upstream.signal, userId)
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
    ...(typeof threadId === 'string' ? [chatSaveTap(threadId, userId)] : []),
    res,
  ).catch(() => {})
})

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
chats.get('/:id', async (req, res) => {
  try {
    res.json({ messages: await getMessages(mine(res), req.params.id) })
  } catch (error) {
    conversationError(res, error)
  }
})
chats.patch('/:id', async (req, res) => {
  try {
    res.json(await renameConversation(mine(res), req.params.id, req.body?.title))
  } catch (error) {
    conversationError(res, error)
  }
})
chats.delete('/:id', async (req, res) => {
  try {
    await deleteConversation(mine(res), req.params.id)
    res.status(204).end()
  } catch (error) {
    conversationError(res, error)
  }
})
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
