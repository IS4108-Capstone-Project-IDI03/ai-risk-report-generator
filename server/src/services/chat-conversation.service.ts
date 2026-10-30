// Saved chats for the knowledge assistant (CB-03): create, list, search, rename, delete
// and read back. Every function takes the signed-in user's id and only ever touches that
// user's chats, so another user's chat looks like it does not exist (AC7).
// Called by routes/chat.routes.ts. Calls the chat models.
import { Types, type HydratedDocument } from 'mongoose'
import { ChatError } from './chat-error'
import { ChatConversationModel } from '../models/chat-conversation.model'
import { ChatMessageModel, type IChatMessage } from '../models/chat-message.model'

const TITLE_CHARS = 60

/** The thread shape OpenUI's storage expects. */
const toThread = (c: { _id: Types.ObjectId; title: string; createdAt: Date }) => ({
  id: String(c._id),
  title: c.title,
  createdAt: c.createdAt.toISOString(),
})

/** Returns the chat if it is this user's, else throws a 404 ChatError. */
export async function ownedConversation(userId: string, id: string) {
  const found = Types.ObjectId.isValid(id)
    ? await ChatConversationModel.findOne({ _id: id, userId })
    : null
  if (!found) throw new ChatError(404, 'Chat not found.')
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
  const words = q?.trim().slice(0, 100)
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

type Stored = HydratedDocument<IChatMessage>
const loadAll = (conversationId: Types.ObjectId) =>
  ChatMessageModel.find({ conversationId }).sort({ createdAt: 1 })
// The id the browser knows a message by: its own, else the stored one.
const shownId = (m: Stored) => m.clientId ?? String(m._id)

/**
 * Returns the version on screen (CB-04): the messages from the first question down to the chat's
 * active leaf, in OpenUI's message shape, plus `versions` for each message that has siblings
 * (same parent and role): all their ids in the order made, and which one is shown.
 */
export async function getMessages(userId: string, id: string) {
  const chat = await ownedConversation(userId, id)
  return pathView(chat.activeLeafId, await loadAll(chat._id))
}

function pathView(leafId: Types.ObjectId | undefined, all: Stored[]) {
  const byId = new Map(all.map((m) => [String(m._id), m]))
  // A chat from before CB-04 has no active leaf: its newest message is the end of its one path.
  let at = (leafId && byId.get(String(leafId))) || all.at(-1)
  const path: Stored[] = []
  while (at) {
    path.unshift(at)
    at = at.parentId ? byId.get(String(at.parentId)) : undefined
  }
  const versions: Record<string, { ids: string[]; index: number }> = {}
  for (const m of path) {
    const siblings = all.filter(
      (o) => String(o.parentId ?? '') === String(m.parentId ?? '') && o.role === m.role,
    )
    if (siblings.length > 1)
      versions[shownId(m)] = {
        ids: siblings.map(shownId),
        index: siblings.findIndex((o) => String(o._id) === String(m._id)),
      }
  }
  return {
    messages: path.map((m) => ({ id: shownId(m), role: m.role, content: m.content })),
    versions,
  }
}

/**
 * Makes `messageId` (one of the chat's messages, by either id) the version on screen, and returns
 * the new view. The end of the path is that message's newest descendants, so the exchanges that
 * followed it come back too. Another chat's message looks like it does not exist.
 */
export async function switchVersion(userId: string, id: string, messageId: unknown) {
  const chat = await ownedConversation(userId, id)
  const all = await loadAll(chat._id)
  const wanted = typeof messageId === 'string' ? messageId : ''
  let leaf: Stored | undefined =
    all.find((m) => shownId(m) === wanted) ?? all.find((m) => String(m._id) === wanted)
  if (!leaf) throw new ChatError(404, 'Chat not found.')
  while (leaf) {
    const parentOf: Stored = leaf
    const next: Stored | undefined = all
      .filter((m) => String(m.parentId) === String(parentOf._id))
      .at(-1)
    if (!next) break
    leaf = next
  }
  chat.activeLeafId = leaf._id
  await chat.save()
  return pathView(leaf._id, all)
}

/** Renames a chat and returns its thread. */
export async function renameConversation(userId: string, id: string, title: unknown) {
  const name = typeof title === 'string' ? title.trim() : ''
  if (!name) throw new ChatError(400, 'A chat needs a name.')
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
