// PDFs attached to a chat (CB-09): check and read an upload, keep its pages with the conversation,
// give them to the answer, and show a cited page again. Called by routes/chat.routes.ts and
// chat-conversation.service.ts. Calls speech.service.ts (S5 reads the text; it stores nothing).
import { Types } from 'mongoose'
import { ChatAttachmentModel } from '../models/chat-attachment.model'
import { ChatError } from './chat-error'
import { SpeechServiceError, extractChatPdf } from './speech.service'

export const MAX_PDF_BYTES = 10 * 1024 * 1024 // must match the raw-body limit in routes/chat.routes.ts

// Phrases that try to give the assistant orders. A file with one is flagged and warned about; its
// text is still only ever read as data (the answer prompt says so, and chat has no actions).
const INSTRUCTION_LIKE = [
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompt)/i,
  /\byou\s+are\s+now\b/i,
  /\b(reveal|show|print)\s+(your|the)\s+(system\s+)?(prompt|instructions|rules)/i,
  /\bsystem\s+prompt\b/i,
  /\bnew\s+instructions\s*:/i,
]
export const looksLikeInstructions = (text: string) => INSTRUCTION_LIKE.some((p) => p.test(text))

/** Reads and keeps a PDF. Returns its id, name, page count, skipped pages and whether it looks like instructions. */
export async function addPdf(userId: string, bytes: Buffer, name: string) {
  if (!bytes.length) throw new ChatError(400, 'That PDF is empty.')
  if (bytes.subarray(0, 5).toString() !== '%PDF-')
    throw new ChatError(415, 'That file is not a PDF.')
  if (bytes.length > MAX_PDF_BYTES) throw new ChatError(413, 'That PDF is over 10 MB.')
  let read: { pages: { page: number; text: string }[]; skipped: number[] }
  try {
    read = await extractChatPdf(bytes)
  } catch (error) {
    if (!(error instanceof SpeechServiceError)) throw error
    // A refusal (scanned, protected, too long) is the file's fault and says why; the rest is ours.
    throw error.retryable
      ? new ChatError(503, 'The PDF could not be read. Try again in a moment.')
      : new ChatError(400, error.message)
  }
  const flagged = read.pages.some((p) => looksLikeInstructions(p.text))
  const saved = await ChatAttachmentModel.create({
    userId,
    name: name.slice(0, 120) || 'document.pdf',
    pages: read.pages,
    skipped: read.skipped,
    flagged,
  })
  return {
    id: String(saved._id),
    name: saved.name,
    pages: read.pages.length,
    skipped: read.skipped,
    flagged,
  }
}

/** Removes a PDF that was attached but never sent. Someone else's, or a sent one, is left alone. */
export async function removeUnsentPdf(userId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return
  await ChatAttachmentModel.deleteOne({ _id: id, userId, conversationId: null })
}

export const MAX_PDFS_PER_CHAT = 3

/**
 * Ties the PDFs named in a question to its conversation (up to 3 per chat) and returns them as
 * {id, name, flagged}. Throws a 400 for one that is not the engineer's, or when the chat would
 * hold more than 3. A PDF the chat already holds is not counted twice, so a retry is fine.
 */
export async function bindPdfs(userId: string, conversationId: string, ids: unknown) {
  if (ids === undefined || ids === null) return []
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !Types.ObjectId.isValid(id))
  )
    throw new ChatError(400, 'That PDF could not be attached.')
  const wanted = [...new Set(ids as string[])]
  if (!wanted.length) return []
  const held = new Set(
    (await ChatAttachmentModel.find({ conversationId, userId }, '_id')).map((f) => String(f._id)),
  )
  if (held.size + wanted.filter((id) => !held.has(id)).length > MAX_PDFS_PER_CHAT)
    throw new ChatError(
      400,
      `A chat can use up to ${MAX_PDFS_PER_CHAT} PDFs. Start a new chat to use more.`,
    )
  const bound = await ChatAttachmentModel.find({
    _id: { $in: wanted },
    userId,
    $or: [{ conversationId: null }, { conversationId }],
  })
  // Anything asked for but not found is someone else's, or gone.
  if (bound.length !== wanted.length) throw new ChatError(400, 'That PDF could not be attached.')
  await ChatAttachmentModel.updateMany({ _id: { $in: wanted } }, { $set: { conversationId } })
  return bound.map((f) => ({ id: String(f._id), name: f.name, flagged: f.flagged }))
}

/** The pages of the PDFs on this conversation, in the shape S4 takes. */
export async function pdfsForChat(userId: string, conversationId: string) {
  const files = await ChatAttachmentModel.find({ userId, conversationId })
  return files.map((f) => ({ id: String(f._id), name: f.name, pages: f.pages }))
}

/** One cited page of an attached PDF, as the citation panel shows a passage; 404 for anyone but its owner. */
export async function pdfPassage(userId: string, passageId: string) {
  const [, id, page] = /^att:([0-9a-f]{24}):(\d+)$/.exec(passageId) ?? []
  const file = id ? await ChatAttachmentModel.findOne({ _id: id, userId }) : null
  const found = file?.pages.find((p) => p.page === Number(page))
  if (!file || !found) throw new ChatError(404, 'Passage not found.')
  return {
    id: passageId,
    documentId: String(file._id),
    text: found.text,
    headings: [file.name],
    pageStart: found.page,
    pageEnd: found.page,
    boxes: [],
  }
}

/** Removes every PDF of a deleted conversation. */
export async function removePdfsOf(userId: string, conversationId: string) {
  await ChatAttachmentModel.deleteMany({ userId, conversationId })
}
