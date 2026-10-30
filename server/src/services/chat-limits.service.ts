// Per-user limits on the knowledge assistant's chat: message length, questions
// per minute and per day, and spend per day (CB-01 AC16).
// Called by routes/chat.routes.ts and chat-usage.service.ts. Calls ai-usage.service.ts for cost.
import { usageCost } from './ai-usage.service'

const MAX_MESSAGE_CHARS = 4000
const MAX_PER_MINUTE = 10
const MAX_PER_DAY = 200
const MAX_SPEND_PER_DAY_USD = 2
// Charged when a question starts and swapped for the real cost when its chat_result
// arrives. Without it, an answer stopped before the end would cost nothing here.
// ponytail: a fixed guess (a Sol answer is about $0.01); per-model estimates if it matters.
const ESTIMATE_USD = 0.02

// Hand-written replies in the chat's voice, one picked at random so a repeat doesn't read as a
// broken bot. No model writes them (CB-01 AC16: refused before any model call). Each still says
// why and what to do next; tests check the key fact (4,000 / a minute / tomorrow) in each.
export const TOO_LONG = [
  'That message is a bit long for me. Could you trim it or split it up? I can read up to 4,000 characters at a time.',
  'I can only take 4,000 characters in one message, and this one is over. Try cutting it down or sending it in parts.',
  'There is too much in that message for me to handle at once. Please shorten it to under 4,000 characters, or split it into a few questions.',
  "That one's over my 4,000 character limit. Could you make it shorter, or break it into smaller questions?",
]
export const PER_MINUTE = [
  "You're asking faster than I can keep up with. Give it about a minute and then ask again.",
  "Let's slow down for a moment. Wait about a minute and I'll be ready for your next question.",
  "That's a lot of questions in a short time. Please wait about a minute, then try again.",
  'I need a short breather. Ask me again in about a minute.',
  "I'm getting a lot of questions from you at once. Try again in about a minute.",
]
export const PER_DAY = [
  "You've used up today's questions. You can ask again tomorrow.",
  "That's all the questions I can take from you today. Come back tomorrow and ask again.",
  "We've hit today's chat limit. It resets overnight, so you can ask again tomorrow.",
  "I've reached my limit for you today. Ask again tomorrow and I'll pick it up from there.",
]
// For when the chat service can't be reached (CB-01); sent by routes/chat.routes.ts.
export const UNAVAILABLE = [
  "I can't reach my sources right now. Please try again in a few minutes.",
  "Something's not working on my side at the moment. Could you try again shortly?",
  "I'm having trouble connecting just now. Give it a few minutes and ask again.",
  "I couldn't get to the knowledge base just then. Please try again soon.",
]

// Each user's last reply, so the same words aren't shown twice in a row.
const lastReply = new Map<string, string>()

/** Returns a random phrasing from `list`, never the user's last reply when there is another. */
export function pickReply(userId: string, list: string[]): string {
  // Never the same line twice in a row: pick from the others.
  const others = list.filter((r) => r !== lastReply.get(userId))
  const pool = others.length ? others : list
  const reply = pool[Math.floor(Math.random() * pool.length)]
  lastReply.set(userId, reply)
  return reply
}

type Usage = { asked: number[]; day: string; questionsToday: number; spendToday: number }

// ponytail: in-memory per-user counters — fine for a single server instance;
// move to Redis if this runs behind more than one instance (a restart also
// clears them, which only ever lets a user ask again early). The spend cap is
// soft: questions already under way when it is reached still finish.
const usage = new Map<string, Usage>()

// Server-local calendar day, so "since midnight" needs no date maths (a UTC
// container resets at 08:00 Singapore time).
const today = () => new Date().toDateString()

// Gets the user's counters, starting fresh if the day has changed.
function usageFor(userId: string): Usage {
  let u = usage.get(userId)
  if (!u || u.day !== today()) {
    u = { asked: [], day: today(), questionsToday: 0, spendToday: 0 }
    usage.set(userId, u)
  }
  return u
}

/**
 * Returns why this question must be refused (shown to the engineer), or null if
 * it may go ahead. `texts` is everything the engineer wrote in the request; any
 * one over the length limit refuses it. Counting it here, in the same step as
 * the check, means two requests sent together cannot both slip under a limit.
 */
export function checkChatLimits(userId: string, texts: string[]): string | null {
  if (texts.some((t) => t.length > MAX_MESSAGE_CHARS)) return pickReply(userId, TOO_LONG)
  const u = usageFor(userId)
  const now = Date.now()
  u.asked = u.asked.filter((t) => now - t < 60_000)
  if (u.asked.length >= MAX_PER_MINUTE) return pickReply(userId, PER_MINUTE)
  if (u.questionsToday >= MAX_PER_DAY || u.spendToday >= MAX_SPEND_PER_DAY_USD) {
    return pickReply(userId, PER_DAY)
  }
  u.asked.push(now)
  u.questionsToday += 1
  u.spendToday += ESTIMATE_USD
  return null
}

/** Swaps one question's estimate for its chat_result's real cost in today's spend; returns nothing. */
export function addChatSpend(userId: string, items: unknown): void {
  if (!Array.isArray(items)) return
  const u = usageFor(userId)
  u.spendToday -= ESTIMATE_USD
  for (const item of items as Parameters<typeof usageCost>[0][]) {
    // Same cost rule as the saved usage rows; an unpriced item adds nothing.
    if (item && typeof item.model === 'string') {
      u.spendToday += usageCost(item).estimatedCostUsd ?? 0
    }
  }
}

/** Clears all counters (for tests); returns nothing. */
export function resetChatLimits(): void {
  usage.clear()
  lastReply.clear()
}
