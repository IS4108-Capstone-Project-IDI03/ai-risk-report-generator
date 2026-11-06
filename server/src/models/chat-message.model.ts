// One message in a saved chat (CB-03). `parentId` links each message to the one before
// it, so a retry or edit (CB-04) can add a sibling later without changing this shape.
// Written by services/chat-conversation.service.ts. Deleted with its conversation.
// No metadata block: see chat-conversation.model.ts.
import { Schema, Types, model } from 'mongoose'

export interface IChatMessage {
  conversationId: Types.ObjectId
  userId: Types.ObjectId
  parentId: Types.ObjectId | null
  // The id the browser gave the message, so a reloaded chat keeps the same ids.
  clientId?: string
  role: 'user' | 'assistant'
  content: string
  // Photos sent with a question (CB-08): ids in chat_photos storage, the version that was sent
  // (blurred or not). Only on user messages.
  attachments?: string[]
  // PDFs attached with a question (CB-09), for showing them when the chat is reopened.
  pdfs?: { id: string; name: string; flagged: boolean }[]
  // 'stopped' = the engineer stopped the answer or the connection dropped; the text so far is kept.
  status: 'complete' | 'stopped'
  createdAt: Date
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    clientId: String,
    attachments: { type: [String], default: undefined },
    pdfs: {
      type: [{ _id: false, id: String, name: String, flagged: Boolean }],
      default: undefined,
    },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['complete', 'stopped'], default: 'complete' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
chatMessageSchema.index({ conversationId: 1, createdAt: 1 })

export const ChatMessageModel = model<IChatMessage>(
  'ChatMessage',
  chatMessageSchema,
  'chat_messages',
)
