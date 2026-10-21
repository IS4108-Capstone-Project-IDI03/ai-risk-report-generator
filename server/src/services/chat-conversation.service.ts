// Saved chats for the knowledge assistant (CB-03): create, list, search, rename, delete
// and read back. Every function takes the signed-in user's id and only ever touches that
// user's chats, so another user's chat looks like it does not exist (AC7).
// Called by routes/chat.routes.ts. Calls the chat models.
import { Types } from 'mongoose'
import { ChatConversationModel } from '../models/chat-conversation.model'
import { ChatMessageModel } from '../models/chat-message.model'

const TITLE_CHARS = 60

/** Thrown when the chat does not exist or is not the user's; the route answers 404 for both. */
export class ConversationNotFound extends Error {}
/** Thrown when a new name is empty; the route answers 400. */
export class InvalidTitle extends Error {}

/** The thread shape OpenUI's storage expects. */
const toThread = (c: { _id: Types.ObjectId; title: string; createdAt: Date }) => ({
  id: String(c._id),
  title: c.title,
  createdAt: c.createdAt.toISOString(),
})

/** Returns the chat if it is this user's, else throws ConversationNotFound. */
export async function ownedConversation(userId: string, id: string) {
  const found = Types.ObjectId.isValid(id)
    ? await ChatConversationModel.findOne({ _id: id, userId })
    : null
  if (!found) throw new ConversationNotFound()
  return found
}

/** Starts a chat named from the first question (trimmed, no AI call). Returns the thread. */
export async function createConversation(userId: string, firstQuestion: string) {
  const title = firstQuestion.trim().slice(0, TITLE_CHARS).trim() || 'New chat'
  return toThread(await ChatConversationModel.create({ userId, title }))
}

/**
 * Returns the user's chats, newest first. With `q`, only chats whose name or any message contains
 * it: case-insensitive, whole or part of a word. The words are escaped, so symbols in them are
 * plain text and cannot act as a pattern (without this, a search for "(" would throw).
 */
export async function listConversations(userId: string, q?: string) {
  const words = q?.trim()
  const filter: Record<string, unknown> = { userId }
  if (words) {
    const pattern = new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const inMessages = await ChatMessageModel.distinct('conversationId', {
      userId,
      content: pattern,
    })
    filter.$or = [{ title: pattern }, { _id: { $in: inMessages } }]
  }
  const chats = await ChatConversationModel.find(filter).sort({ updatedAt: -1 })
  return chats.map(toThread)
}

/** Returns a chat's messages in the order they were sent, in OpenUI's message shape. */
export async function getMessages(userId: string, id: string) {
  const chat = await ownedConversation(userId, id)
  const messages = await ChatMessageModel.find({ conversationId: chat._id }).sort({ createdAt: 1 })
  return messages.map((m) => ({
    id: m.clientId ?? String(m._id),
    role: m.role,
    content: m.content,
  }))
}

/** Renames a chat and returns its thread. */
export async function renameConversation(userId: string, id: string, title: unknown) {
  const name = typeof title === 'string' ? title.trim() : ''
  if (!name) throw new InvalidTitle()
  const chat = await ownedConversation(userId, id)
  chat.title = name.slice(0, 100)
  await chat.save()
  return toThread(chat)
}

/** Deletes a chat for good, with all its messages. */
export async function deleteConversation(userId: string, id: string) {
  const chat = await ownedConversation(userId, id)
  await ChatMessageModel.deleteMany({ conversationId: chat._id })
  await chat.deleteOne()
}
