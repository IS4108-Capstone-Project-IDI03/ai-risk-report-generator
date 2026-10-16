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

const TOO_LONG_MESSAGE = 'Your message is too long. Please keep it under 4,000 characters.'
const PER_MINUTE_MESSAGE =
  "You've asked a lot of questions in the last minute. Please wait a minute and try again."
const PER_DAY_MESSAGE = "You've reached today's chat limit. You can ask again tomorrow."

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
  if (texts.some((t) => t.length > MAX_MESSAGE_CHARS)) return TOO_LONG_MESSAGE
  const u = usageFor(userId)
  const now = Date.now()
  u.asked = u.asked.filter((t) => now - t < 60_000)
  if (u.asked.length >= MAX_PER_MINUTE) return PER_MINUTE_MESSAGE
  if (u.questionsToday >= MAX_PER_DAY || u.spendToday >= MAX_SPEND_PER_DAY_USD) {
    return PER_DAY_MESSAGE
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
}
