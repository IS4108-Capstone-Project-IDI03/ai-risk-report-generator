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
import { checkChatLimits, pickReply, UNAVAILABLE } from '../services/chat-limits.service'
import { chatUsageTap } from '../services/chat-usage.service'
import {
  getPassage,
  openChatStream,
  RagServiceError,
  withChatDocuments,
} from '../services/rag.service'

const router = Router()

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
  const reason = checkChatLimits(userId, engineerTexts(req.body))
  if (reason) {
    refuse(res, reason)
    return
  }
  // Without this, S4 keeps writing an answer after the engineer presses stop.
  const upstream = new AbortController()
  res.on('close', () => upstream.abort())
  let stream: ReadableStream<Uint8Array>
  try {
    stream = await openChatStream(
      // The role is set here, never taken from the browser: it decides who S4 offers to add a document.
      { ...(await withChatDocuments(req.body)), role: res.locals.user!.role },
      upstream.signal,
      userId,
    )
  } catch (error: unknown) {
    if (error instanceof RagServiceError) {
      // A chat reply, not a 503: OpenUI's fetchLLM would show a generic error box instead.
      refuse(res, pickReply(userId, UNAVAILABLE))
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
    res,
  ).catch(() => {})
})

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
