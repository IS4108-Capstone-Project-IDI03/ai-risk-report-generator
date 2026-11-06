// A PDF attached to a chat (CB-09): the text of each page, kept so every question in that
// conversation can use it and no other conversation can. Written by services/chat-pdf.service.ts.
// `conversationId` is null until the first question that uses it is sent. Deleted with its
// conversation. No metadata block: it is not retrieval evidence, see chat-conversation.model.ts.
import { Schema, Types, model } from 'mongoose'

export interface IChatAttachment {
  userId: Types.ObjectId
  conversationId: Types.ObjectId | null
  name: string
  pages: { page: number; text: string }[]
  // Pages with no text (pictures only), left out of what the answer reads.
  skipped: number[]
  // The text tells the assistant what to do; it is still treated as data (AC6).
  flagged: boolean
  createdAt: Date
}

const chatAttachmentSchema = new Schema<IChatAttachment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'ChatConversation', default: null },
    name: { type: String, required: true },
    pages: [{ _id: false, page: Number, text: String }],
    skipped: [Number],
    flagged: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
chatAttachmentSchema.index({ conversationId: 1 })

export const ChatAttachmentModel = model<IChatAttachment>(
  'ChatAttachment',
  chatAttachmentSchema,
  'chat_attachments',
)
