// The knowledge assistant's chat endpoint (CB-01). Passes the chat screen's
// request to S4 and streams S4's answer events (AG-UI, as server-sent events)
// back unchanged, apart from the usage event at the end, which the service
// records and removes (EV-03). Called by client/src/features/chat/api.ts.
import { randomUUID } from 'node:crypto'
import express, { Router, type Request, type RequestHandler, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { requirePermission } from '../middleware/auth.middleware'
import { ChatError } from '../services/chat-error'
import { checkChatLimits, pickReply, UNAVAILABLE } from '../services/chat-limits.service'
import { chatSaveTap, lastQuestion, saveQuestion } from '../services/chat-save.service'
import { chatUsageTap } from '../services/chat-usage.service'
import { chatPrivacy } from '../services/privacy.service'
import { MAX_AUDIO_BYTES, transcribeQuestion } from '../services/chat-voice.service'
import {
  MAX_PHOTO_BYTES,
  addPhoto,
  keepChosen,
  openPhoto,
  photoContext,
  removePhotos,
  sentPhotoIds,
} from '../services/chat-attachment.service'
import { SpeechServiceError } from '../services/speech.service'
import {
  MAX_PDF_BYTES,
  addPdf,
  bindPdfs,
  pdfPassage,
  pdfsForChat,
  removeUnsentPdf,
} from '../services/chat-pdf.service'
import { ChatMessageModel } from '../models/chat-message.model'
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

// `{ attachments }` for this chat's PDF, or nothing when it has none, so a chat without one sends
// S4 exactly what it did before (CB-09).
async function attachedPdfs(userId: string, threadId: unknown) {
  const files = typeof threadId === 'string' ? await pdfsForChat(userId, threadId) : []
  return files.length ? { attachments: files } : {}
}

// The request with extra context lines added after any the browser sent.
function withContext(body: unknown, lines: { description: string; value: string }[]) {
  if (!lines.length) return body
  const context = (body as { context?: unknown })?.context
  return { ...(body as object), context: [...(Array.isArray(context) ? context : []), ...lines] }
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

// A spoken question as text (CB-10 AC1). The recording is the raw request body.
router.post(
  '/transcribe',
  requirePermission('knowledge:view'),
  express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }),
  handle(async (req, res) => {
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    res.json({ text: await transcribeQuestion(audio, req.get('Content-Type') ?? '') })
  }),
)

// A photo for a question (CB-08): the file is the raw body. Stored and face-checked at once, so the
// engineer can choose to blur before sending. Answers `{ id, faces, blurredId }`.
router.post(
  '/photos',
  requirePermission('knowledge:view'),
  express.raw({ type: 'image/*', limit: MAX_PHOTO_BYTES }),
  handle(async (req, res) => {
    // A type other than JPG or PNG never reaches the body parser, so it is refused here.
    if (!Buffer.isBuffer(req.body))
      throw new ChatError(415, 'Only JPG and PNG photos can be attached.')
    res.json(await addPhoto(res.locals.user!.id, req.body))
  }),
)
router.get(
  '/photos/:id',
  requirePermission('knowledge:view'),
  handle(async (req, res) => {
    const { stream, contentType } = await openPhoto(res.locals.user!.id, req.params.id)
    res.setHeader('Content-Type', contentType)
    // The photo may show a client's site: never cached by a shared proxy.
    res.setHeader('Cache-Control', 'private, max-age=3600')
    await pipeline(stream, res)
  }),
)
router.delete(
  '/photos/:id',
  requirePermission('knowledge:view'),
  handle(async (req, res) => {
    await removePhotos(res.locals.user!.id, [req.params.id])
    res.status(204).end()
  }),
)

// A PDF for a conversation (CB-09): the file is the raw body, its name is in `X-File-Name`. Read at
// once, so a file that cannot be used is refused before the question is written.
router.post(
  '/pdfs',
  requirePermission('knowledge:view'),
  express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }),
  handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new ChatError(415, 'That file is not a PDF.')
    const name = decodeURIComponent(req.get('X-File-Name') ?? '').trim()
    res.json(await addPdf(res.locals.user!.id, req.body, name))
  }),
)
router.delete(
  '/pdfs/:id',
  requirePermission('knowledge:view'),
  handle(async (req, res) => {
    await removeUnsentPdf(res.locals.user!.id, req.params.id)
    res.status(204).end()
  }),
)

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
  // a2. The photos sent with the question (CB-08): only the engineer's own, up to 3.
  let photos: string[]
  try {
    photos = sentPhotoIds(req.body?.attachments)
    await keepChosen(userId, photos)
  } catch (error) {
    return chatError(res, error)
  }
  // a3. The PDF sent with the question (CB-09): tied to this chat, one per chat.
  let pdfs: { id: string; name: string; flagged: boolean }[]
  try {
    pdfs = typeof threadId === 'string' ? await bindPdfs(userId, threadId, req.body?.pdfs) : []
  } catch (error) {
    return chatError(res, error)
  }
  // b. Save the question before asking S4, so it is kept even if the answer fails.
  const question = lastQuestion(req.body)
  // A failed save is logged, not fatal: the engineer still gets their answer.
  const questionId =
    typeof threadId === 'string' && question
      ? await saveQuestion(threadId, userId, question, photos, pdfs).catch((error) => {
          console.error('Could not save the chat question:', error)
          return null
        })
      : null
  // A retry sends no photos: the saved question's own are used again (CB-08 AC5).
  if (!photos.length && questionId) {
    photos = (await ChatMessageModel.findById(questionId, 'attachments'))?.attachments ?? []
  }
  // Without this, S4 keeps writing an answer after the engineer presses stop.
  const upstream = new AbortController()
  res.on('close', () => upstream.abort())
  let stream: ReadableStream<Uint8Array>
  try {
    const seen = photos.length ? await photoContext(userId, photos) : []
    stream = await openChatStream(
      // The role is set here, never taken from the browser: it decides who S4 offers to add a document.
      // The gateway decides protection (PV-03), replacing any privacy the browser sent.
      {
        ...(await withChatDocuments(await withChatMemory(withContext(req.body, seen), userId))),
        // The pages of this chat's PDF, read from storage, never from the browser (CB-09).
        ...(await attachedPdfs(userId, threadId)),
        role: res.locals.user!.role,
        privacy: await chatPrivacy(),
      },
      upstream.signal,
      userId,
    )
  } catch (error: unknown) {
    if (error instanceof SpeechServiceError) {
      // A chat reply, like the other failures here: nothing is asked of the answer model.
      refuse(res, 'I could not read that photo. Please try again, or ask without it.')
      return
    }
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
    // A page of the engineer's own attached PDF is kept here, not in S4's index (CB-09).
    if (req.params.id.startsWith('att:')) {
      res.json(await pdfPassage(res.locals.user!.id, req.params.id))
      return
    }
    res.json(await getPassage(req.params.id))
  } catch (error: unknown) {
    if (!(error instanceof RagServiceError)) throw error
    // 404 means S4 doesn't know the id; anything else (down, failed) is 503.
    if (error.status === 404) res.status(404).json({ error: error.message })
    else res.status(503).json({ error: error.message })
  }
})

export default router
