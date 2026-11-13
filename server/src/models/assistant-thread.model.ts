// MarshBot's saved conversation with one engineer about one assessment (AS-06
// round 5): earlier sessions (frozen) and the session now, with what MarshBot
// has said and is waiting on. Written by services/assistant/thread.service.ts;
// read by it and brief.service.ts. Not a knowledge or observation document, so
// the metadata-fields rule doesn't apply.
import { Schema, Types, model } from 'mongoose'
import type { Reply, Session, Turn } from '../services/assistant/types'

// A turn as saved: a tasks turn keeps the item ids its card follows, and a turn
// whose words sit between its cards keeps that order (thread/session.ts partsOf).
export type StoredTurn = Turn & { items?: string[]; order?: ('say' | 'card')[] }

// What MarshBot waits on: the topic its newest turn raised (`turnId` null while
// the coverage check it needs is still running), and that turn's own replies.
export type Waiting = {
  topic: string
  turnId: string | null
  kind: 'tasks' | 'info' | 'question'
  items: string[]
  replies: Reply[]
}

export type StoredSession = Omit<Session, 'turns'> & {
  turns: StoredTurn[]
  // Topics raised this session ('todo', 'checklist', …) and `item:<id>` per task raised.
  said: string[]
  waiting: Waiting | null
  // The observation count when last advanced, for the next session's catch-up.
  observations: number
}

export interface IAssistantThread {
  assessment: Types.ObjectId
  user: Types.ObjectId
  reference: string
  earlier: StoredSession[] // oldest first, at most ASSISTANT.keepSessions
  session: StoredSession | null
  updatedAt: Date
}

const threadSchema = new Schema<IAssistantThread>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reference: { type: String, required: true, index: true },
    // Mixed: shapes fixed by the types above and written only by thread.service.ts.
    earlier: { type: Schema.Types.Mixed, default: [] },
    session: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'assistant_threads',
    minimize: false,
  },
)
threadSchema.index({ assessment: 1, user: 1 }, { unique: true })

export const AssistantThreadModel = model<IAssistantThread>('AssistantThread', threadSchema)
