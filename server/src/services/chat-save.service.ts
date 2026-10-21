// Saves the knowledge assistant's question and answer into the user's chat (CB-03).
// The question is saved before S4 is called; the answer is copied off the stream as it
// passes and saved when it ends. Called by routes/chat.routes.ts. Calls the chat models.
import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { ChatConversationModel } from '../models/chat-conversation.model'
import { ChatMessageModel } from '../models/chat-message.model'

/** Returns the text of the engineer's latest question in a chat request, or null if there is none. */
export function lastQuestion(body: unknown) {
  const { messages } = (body ?? {}) as {
    messages?: { id?: unknown; role?: string; content?: unknown }[]
  }
  const last = Array.isArray(messages)
    ? messages.filter((m) => m?.role === 'user').at(-1)
    : undefined
  return last && typeof last.content === 'string'
    ? { id: typeof last.id === 'string' ? last.id : undefined, content: last.content }
    : null
}

// Adds a message after the chat's latest one and bumps the chat to the top of the list.
async function append(
  conversationId: string,
  userId: string,
  message: {
    role: 'user' | 'assistant'
    content: string
    clientId?: string
    status?: 'complete' | 'stopped'
  },
) {
  const previous = await ChatMessageModel.findOne({ conversationId }).sort({ createdAt: -1 })
  await ChatMessageModel.create({
    ...message,
    conversationId,
    userId,
    parentId: previous?._id ?? null,
  })
  await ChatConversationModel.updateOne(
    { _id: conversationId },
    { $set: { updatedAt: new Date() } },
  )
}

/** Saves the engineer's question into the chat. */
export async function saveQuestion(
  conversationId: string,
  userId: string,
  question: { id?: string; content: string },
) {
  // A retry re-sends the same message id; saving it again would show the question twice.
  if (
    question.id &&
    (await ChatMessageModel.exists({ conversationId, role: 'user', clientId: question.id }))
  )
    return
  await append(conversationId, userId, {
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
export function chatSaveTap(conversationId: string, userId: string): Transform {
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
    return append(conversationId, userId, {
      role: 'assistant',
      content: text,
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
