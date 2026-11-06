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

/**
 * Ties the PDFs named in a question to its conversation (one per chat) and returns them as
 * {id, name, flagged}. Throws a 400 for one that is not the engineer's, or a second one.
 */
export async function bindPdfs(userId: string, conversationId: string, ids: unknown) {
  if (ids === undefined || ids === null) return []
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !Types.ObjectId.isValid(id))
  )
    throw new ChatError(400, 'That PDF could not be attached.')
  if (!ids.length) return []
  if (ids.length > 1) throw new ChatError(400, 'Attach one PDF to a chat.')
  const existing = await ChatAttachmentModel.findOne({ conversationId, userId })
  if (existing && String(existing._id) !== ids[0])
    throw new ChatError(400, 'This chat already has a PDF. Start a new chat to use another.')
  const bound = await ChatAttachmentModel.findOneAndUpdate(
    { _id: ids[0], userId, $or: [{ conversationId: null }, { conversationId }] },
    { $set: { conversationId } },
    { new: true },
  )
  if (!bound) throw new ChatError(400, 'That PDF could not be attached.')
  return [{ id: String(bound._id), name: bound.name, flagged: bound.flagged }]
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
