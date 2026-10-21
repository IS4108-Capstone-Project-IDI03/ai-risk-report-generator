// A saved chat with the knowledge assistant (CB-03): its owner and name. Its messages
// are in chat-message.model.ts. Written by services/chat-conversation.service.ts.
// No metadata block (CLAUDE.md's rule): this is a user's own chat history, not a
// knowledge or review record. See docs/areas/database.md.
import { Schema, Types, model } from 'mongoose'

export interface IChatConversation {
  // Only this user can read it; admins cannot (CB-03 AC7).
  userId: Types.ObjectId
  title: string
  createdAt: Date
  updatedAt: Date
}

const chatConversationSchema = new Schema<IChatConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
  },
  { timestamps: true },
)
// The list: one user's chats, newest first.
chatConversationSchema.index({ userId: 1, updatedAt: -1 })

export const ChatConversationModel = model<IChatConversation>(
  'ChatConversation',
  chatConversationSchema,
  'chat_conversations',
)
