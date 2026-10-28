// Saves the knowledge assistant's question and answer into the user's chat (CB-03).
// The question is saved before S4 is called; the answer is copied off the stream as it
// passes and saved when it ends. Called by routes/chat.routes.ts. Calls the chat models.
import { Transform } from 'node:stream'
import { Types } from 'mongoose'
import { StringDecoder } from 'node:string_decoder'
import { ChatConversationModel } from '../models/chat-conversation.model'
import { ChatMessageModel } from '../models/chat-message.model'

/**
 * Returns the engineer's latest question in a chat request, or null if there is none. `parentId`
 * is the id of the message just before it on screen: the question hangs under that message, so a
 * retry or an edit lands beside the old version instead of after the newest message (CB-04).
 */
export function lastQuestion(body: unknown) {
  const { messages } = (body ?? {}) as {
    messages?: { id?: unknown; role?: string; content?: unknown }[]
  }
  const list = Array.isArray(messages) ? messages : []
  const at = list.map((m) => m?.role).lastIndexOf('user')
  const last = list[at]
  // The message before it that the chat saves: tool messages and empty search-step messages are not.
  const before = list
    .slice(0, Math.max(at, 0))
    .reverse()
    .find((m) => (m?.role === 'user' || m?.role === 'assistant') && !!m.content)?.id
  return last && typeof last.content === 'string'
    ? {
        id: typeof last.id === 'string' ? last.id : undefined,
        content: last.content,
        parentId: typeof before === 'string' ? before : undefined,
      }
    : null
}

// Finds a message of this chat by the id the browser knows it by (its own id, else the stored one).
async function findMessage(conversationId: string, id?: string) {
  if (!id) return null
  return (
    (await ChatMessageModel.findOne({ conversationId, clientId: id })) ??
    (Types.ObjectId.isValid(id)
      ? await ChatMessageModel.findOne({ conversationId, _id: id })
      : null)
  )
}

// Adds a message under `parentId`, makes it the version on screen and bumps the chat to the top.
async function append(
  conversationId: string,
  userId: string,
  parentId: Types.ObjectId | null,
  message: {
    role: 'user' | 'assistant'
    content: string
    clientId?: string
    status?: 'complete' | 'stopped'
  },
) {
  const saved = await ChatMessageModel.create({ ...message, conversationId, userId, parentId })
  await ChatConversationModel.updateOne(
    { _id: conversationId },
    { $set: { updatedAt: new Date(), activeLeafId: saved._id } },
  )
  return saved._id
}

/**
 * Saves the engineer's question under the message before it on screen and returns its id, which
 * the answer will hang under. A question already saved there, with the same id or the same
 * words, is reused: that is a retry, and it must add an answer, not a second question.
 */
export async function saveQuestion(
  conversationId: string,
  userId: string,
  question: { id?: string; content: string; parentId?: string },
) {
  // A parent the chat doesn't know falls back to the newest message, as chats did before CB-04.
  const parent =
    (await findMessage(conversationId, question.parentId)) ??
    (question.parentId
      ? await ChatMessageModel.findOne({ conversationId }).sort({ createdAt: -1 })
      : null)
  const parentId = parent?._id ?? null
  const same = await ChatMessageModel.findOne({
    conversationId,
    role: 'user',
    $or: [
      ...(question.id ? [{ clientId: question.id }] : []),
      { parentId, content: question.content },
    ],
  })
  if (same) {
    await ChatConversationModel.updateOne(
      { _id: conversationId },
      { $set: { activeLeafId: same._id } },
    )
    return same._id
  }
  return append(conversationId, userId, parentId, {
    role: 'user',
    content: question.content,
    clientId: question.id,
  })
}

/**
 * Returns a pass-through stream that collects the answer's text and saves it when the stream
 * ends: complete if S4 sent TEXT_MESSAGE_END, stopped if the stream was cut off first (the
 * engineer pressed stop, or the connection dropped). Without the stopped save, a stopped answer
 * would vanish when the chat is reopened.
 */
export function chatSaveTap(
  conversationId: string,
  userId: string,
  questionId: Types.ObjectId | null,
): Transform {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let text = ''
  // The answer is one message; text of any other message id is not part of it.
  let answerId: string | undefined
  let ended = false
  let saved = false
  const scan = (chunk: string) => {
    pending += chunk
    const events = pending.split('\n\n')
    pending = events.pop() ?? ''
    for (const event of events) {
      try {
        const data = JSON.parse(event.replace(/^data: ?/, ''))
        if (data.type === 'TEXT_MESSAGE_CONTENT' && typeof data.delta === 'string') {
          answerId ??= data.messageId
          if (data.messageId === answerId) text += data.delta
        }
        if (data.type === 'TEXT_MESSAGE_END') ended = true
      } catch {
        // Not JSON: nothing to collect.
      }
    }
  }
  // Runs once. A failed save is logged, never thrown: it must not break the answer stream.
  const save = () => {
    if (saved || !text) return Promise.resolve()
    saved = true
    return append(conversationId, userId, questionId, {
      role: 'assistant',
      content: text,
      clientId: answerId,
      status: ended ? 'complete' : 'stopped',
    }).catch((error) => console.error('Could not save the chat answer:', error))
  }
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      done(null, chunk)
      scan(decoder.write(chunk))
    },
    flush(done) {
      // The last event may have no closing blank line; without this it would be missed, and a
      // finished answer would be saved as stopped.
      scan(decoder.end() + '\n\n')
      void save().then(() => done())
    },
    destroy(error, done) {
      void save().then(() => done(error))
    },
  })
}
