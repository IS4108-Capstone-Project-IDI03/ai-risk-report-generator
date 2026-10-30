// "My preferences" for the knowledge assistant (CB-05): the engineer's own lasting facts and
// the on/off switch. Every function takes the signed-in user's id and only touches that user's
// facts, so another user's fact looks like it does not exist.
// Called by routes/chat.routes.ts. Calls the memory model and the user model.
import { Types } from 'mongoose'
import { ChatError } from './chat-error'
import { ChatMemoryFactModel } from '../models/chat-memory-fact.model'
import { UserModel } from '../models/user.model'

export const MAX_FACT_CHARS = 200
export const MAX_FACTS = 20

const toFact = (f: { _id: Types.ObjectId; text: string; createdAt: Date }) => ({
  id: String(f._id),
  text: f.text,
  createdAt: f.createdAt.toISOString(),
})

// Returns the cleaned text, or throws a 400 ChatError. Line breaks and runs of spaces become one
// space: a fact is one line, and a line break inside it could pass for a new line of the prompt.
function cleanText(text: unknown) {
  const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (!clean || clean.length > MAX_FACT_CHARS)
    throw new ChatError(400, `A fact needs 1 to ${MAX_FACT_CHARS} characters.`)
  return clean
}

/** Returns whether memory is on for the user (it is by default). */
async function isEnabled(userId: string) {
  const user = await UserModel.findById(userId).select('chatMemoryEnabled')
  return user?.chatMemoryEnabled !== false
}

/** Returns the user's switch, their facts oldest first, and the limits the form shows. */
export async function getMemory(userId: string) {
  const facts = await ChatMemoryFactModel.find({ userId }).sort({ createdAt: 1 })
  return {
    enabled: await isEnabled(userId),
    facts: facts.map(toFact),
    maxFacts: MAX_FACTS,
    maxChars: MAX_FACT_CHARS,
  }
}

/** Adds a fact and returns it. Throws a 400 ChatError, or a 409 at 20 facts. */
export async function addFact(userId: string, text: unknown) {
  const clean = cleanText(text)
  if ((await ChatMemoryFactModel.countDocuments({ userId })) >= MAX_FACTS) {
    throw new ChatError(409, `You can keep up to ${MAX_FACTS} facts. Delete one to add another.`)
  }
  return toFact(await ChatMemoryFactModel.create({ userId, text: clean }))
}

/** Changes a fact's text and returns it. */
export async function editFact(userId: string, id: string, text: unknown) {
  const clean = cleanText(text)
  const fact = Types.ObjectId.isValid(id)
    ? await ChatMemoryFactModel.findOneAndUpdate(
        { _id: id, userId },
        { text: clean },
        { new: true },
      )
    : null
  if (!fact) throw new ChatError(404, 'Fact not found.')
  return toFact(fact)
}

/** Deletes a fact for good. */
export async function deleteFact(userId: string, id: string) {
  const gone = Types.ObjectId.isValid(id)
    ? await ChatMemoryFactModel.findOneAndDelete({ _id: id, userId })
    : null
  if (!gone) throw new ChatError(404, 'Fact not found.')
}

/** Turns memory on or off; the facts are kept either way. Throws a 400 ChatError for a non-boolean. */
export async function setMemoryEnabled(userId: string, enabled: unknown) {
  if (typeof enabled !== 'boolean') throw new ChatError(400, '`enabled` must be true or false.')
  await UserModel.updateOne({ _id: userId }, { $set: { chatMemoryEnabled: enabled } })
  return getMemory(userId)
}

/**
 * Returns the chat body with the user's facts added to its `context`, after any context the
 * browser sent. Facts come from the database, never from the browser, and none are added while
 * memory is off (AC5, AC6). S4 shows them to the answer model as "Engineer context", so a fact
 * steers the answer but is never cited as evidence (S4 only cites passages).
 */
export async function withChatMemory(body: unknown, userId: string): Promise<object> {
  try {
    const [on, facts] = await Promise.all([
      isEnabled(userId),
      ChatMemoryFactModel.find({ userId }).sort({ createdAt: 1 }),
    ])
    if (!on || !facts.length) return body as object
    const { context } = (body ?? {}) as { context?: unknown }
    return {
      ...(body as object),
      context: [
        ...(Array.isArray(context) ? context : []),
        // "Preference:" is what S4's answer rules key on to treat a line as a steer, not evidence.
        ...facts.map((f) => ({
          description: 'Engineer preference',
          value: `Preference: ${f.text}`,
        })),
      ],
    }
  } catch (error) {
    // Memory is optional: if it cannot be read, the chat still answers, just without the facts.
    console.error('Could not read the chat memory:', error)
    return body as object
  }
}
