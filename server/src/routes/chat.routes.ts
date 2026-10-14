// The knowledge assistant's chat endpoint (CB-01). Passes the chat screen's
// request to S4 and streams S4's answer events (AG-UI, as server-sent events)
// back unchanged. Called by client/src/features/chat/api.ts.
import { Router } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { requirePermission } from '../middleware/auth.middleware'
import { chatUsageTap } from '../services/chat-usage.service'
import { openChatStream, RagServiceError, withChatDocuments } from '../services/rag.service'

const router = Router()

router.post('/', requirePermission('knowledge:view'), async (req, res) => {
  // Without this, S4 keeps writing an answer after the engineer presses stop.
  const upstream = new AbortController()
  res.on('close', () => upstream.abort())
  let stream: ReadableStream<Uint8Array>
  try {
    stream = await openChatStream(await withChatDocuments(req.body), upstream.signal)
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
    chatUsageTap(),
    res,
  ).catch(() => {})
})

export default router
