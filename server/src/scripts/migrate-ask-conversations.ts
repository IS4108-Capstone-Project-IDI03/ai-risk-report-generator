// Moves the Ask tab's questions saved before AS-03, one document each in
// `assessment_questions`, into conversations in `assistant_conversations`:
// each user's questions on one assessment become one conversation (more than
// one past 100 questions), named from its first question, so the tab opens on
// them as before. Each question keeps its id, answer, sources and trace, and
// gains the provider, model and prompt version its trace names and when its
// answer ended (AS-03 AC3). Once every question is in a conversation, the old
// collection is dropped.
// Safe to run more than once: a question already moved is skipped.
//   npm --prefix server run migrate:ask-conversations
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { connectDb } from '../models/db'
import {
  AssistantConversationModel,
  MAX_CONVERSATION_QUESTIONS,
  type IConversationTurn,
} from '../models/assistant-conversation.model'
import { conversationTitle } from '../services/assessment-ask.service'

export const OLD_COLLECTION = 'assessment_questions'

// A question as AS-01 and AS-02 saved it.
type OldQuestion = Omit<
  IConversationTurn,
  'provider' | 'model' | 'promptVersion' | 'askedAt' | 'answeredAt'
> & {
  assessment: Types.ObjectId
  userId: Types.ObjectId
  metadata: { jurisdiction: string; facility_type: string }
  createdAt: Date
  updatedAt: Date
}

const textOf = (value: unknown) => (typeof value === 'string' && value ? value : null)

function turnOf(q: OldQuestion): IConversationTurn {
  const trace = q.trace ?? null
  return {
    _id: q._id,
    question: q.question,
    passage: q.passage ?? null,
    status: q.status,
    statements: q.statements ?? [],
    missing: q.missing ?? [],
    sources: q.sources ?? {},
    confidence: q.confidence ?? null,
    error: q.error ?? null,
    provider: textOf(trace?.provider),
    model: textOf(trace?.model),
    promptVersion: textOf(trace?.prompt_version),
    askedAt: q.createdAt,
    // The answer was written when the question was last saved.
    answeredAt: q.status === 'answering' ? null : q.updatedAt,
    trace,
  }
}

/** Moves the old questions; returns how many questions and conversations, and whether the old collection was dropped. */
export async function migrateAskConversations() {
  const db = mongoose.connection.db
  if (!db) throw new Error('Not connected to MongoDB.')
  const exists = await db.listCollections({ name: OLD_COLLECTION }, { nameOnly: true }).hasNext()
  if (!exists) return { questions: 0, conversations: 0, dropped: false }
  const old = db.collection<OldQuestion>(OLD_COLLECTION)
  const all = await old.find().sort({ createdAt: 1, _id: 1 }).toArray()
  const moved = new Set(
    (
      await AssistantConversationModel.distinct('turns._id', {
        'turns._id': { $in: all.map((q) => q._id) },
      })
    ).map(String),
  )
  const groups = new Map<string, OldQuestion[]>()
  for (const q of all) {
    if (moved.has(String(q._id))) continue
    const key = `${q.assessment}:${q.userId}`
    groups.set(key, [...(groups.get(key) ?? []), q])
  }
  let conversations = 0
  let questions = 0
  for (const group of groups.values()) {
    for (let at = 0; at < group.length; at += MAX_CONVERSATION_QUESTIONS) {
      const part = group.slice(at, at + MAX_CONVERSATION_QUESTIONS)
      const [first] = part
      const last = part.at(-1)!
      // Its own times, not now's: it started with its first question.
      const conversation = new AssistantConversationModel({
        assessment: first.assessment,
        userId: first.userId,
        title: conversationTitle(first.question),
        lastAskedAt: last.createdAt,
        turns: part.map(turnOf),
        metadata: {
          source_type: 'assistant_conversation',
          jurisdiction: first.metadata.jurisdiction,
          facility_type: first.metadata.facility_type,
          COPE_dimension: 'all',
          effective_date: first.createdAt,
        },
        createdAt: first.createdAt,
        updatedAt: last.updatedAt,
      })
      await conversation.save({ timestamps: false })
      conversations++
      questions += part.length
    }
  }
  // Dropped only once every old question is found in a conversation.
  const kept = await AssistantConversationModel.distinct('turns._id', {
    'turns._id': { $in: all.map((q) => q._id) },
  })
  const dropped = kept.length === all.length
  if (dropped) await old.drop()
  return { questions, conversations, dropped }
}

async function migrate() {
  await connectDb()
  const done = await migrateAskConversations()
  console.log(
    `Questions moved: ${done.questions}, into ${done.conversations} conversations. ` +
      (done.dropped ? `${OLD_COLLECTION} dropped.` : `${OLD_COLLECTION} kept.`),
  )
  await mongoose.disconnect()
}

// Run from the command line; a test imports migrateAskConversations alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
