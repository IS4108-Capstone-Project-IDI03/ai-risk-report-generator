// One fact an engineer keeps in "My preferences" (CB-05), e.g. "I mostly survey Singapore
// offices". Typed by the engineer, never extracted from a chat. Written by
// services/chat-memory.service.ts; sent to S4 as chat context. No metadata block:
// see chat-conversation.model.ts and docs/areas/database.md.
import { Schema, Types, model } from 'mongoose'

export interface IChatMemoryFact {
  // Only this user can read or change it. Nothing deletes it with the account yet: accounts are only deactivated.
  userId: Types.ObjectId
  text: string
  createdAt: Date
}

const chatMemoryFactSchema = new Schema<IChatMemoryFact>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
// The list: one user's facts in the order they were added.
chatMemoryFactSchema.index({ userId: 1, createdAt: 1 })

export const ChatMemoryFactModel = model<IChatMemoryFact>(
  'ChatMemoryFact',
  chatMemoryFactSchema,
  'chat_memory_facts',
)
