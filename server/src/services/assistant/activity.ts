// The engineer's activity (AS-06 Architecture 5): running totals per place,
// and the "read" rule. Called by brief.service.ts (POST activity) and the
// reminder checks.
import { z } from 'zod'
import type { Types } from 'mongoose'
import { AssistantActivityModel } from '../../models/assistant-activity.model'
import { ASSISTANT } from './settings'

const HOUR_MS = 3_600_000
// The body of POST .../assistant/activity: what the browser counted since its last send.
export const activitySchema = z.object({
  places: z
    .array(
      z.object({
        place: z.string().regex(/^(tab:[a-z-]{1,20}|checklist|review|section:[0-9A-Za-z]{1,3})$/),
        engagedMs: z.number().int().min(0).max(HOUR_MS),
        seen: z.record(z.string().min(1).max(100), z.number().int().min(0).max(HOUR_MS)),
      }),
    )
    .max(30),
})
export type ActivityInput = z.infer<typeof activitySchema>

// A seen key as stored: MongoDB can't $inc a field whose name holds a dot
// (finding keys like `0.2` do) or starts with $, so both are percent-encoded.
const encodeKey = (key: string) => encodeURIComponent(key).replace(/\./g, '%2E')
/** Returns a stored seen key as the browser sent it. */
export const decodeKey = (key: string) => decodeURIComponent(key)

/** Adds the browser's counts to the running totals; returns nothing. */
export async function recordActivity(
  assessment: Types.ObjectId,
  user: string,
  input: ActivityInput,
): Promise<void> {
  // Over 2000 keys from one send is not a person reading; without the cap one request could bloat the document.
  if (input.places.reduce((n, p) => n + Object.keys(p.seen).length, 0) > 2000) return
  await Promise.all(
    input.places.map(({ place, engagedMs, seen }) =>
      AssistantActivityModel.updateOne(
        { assessment, user, place },
        {
          $inc: {
            engagedMs,
            ...Object.fromEntries(
              Object.entries(seen).map(([k, ms]) => [`seen.${encodeKey(k)}`, ms]),
            ),
          },
        },
        { upsert: true },
      ),
    ),
  )
}

/** Returns whether these keys were read: enough of them on screen long enough (80% for 2 s by default). */
export function wasRead(seen: Record<string, number> | undefined, keys: string[]): boolean {
  if (!keys.length) return true
  const read = keys.filter((k) => (seen?.[k] ?? 0) >= ASSISTANT.readMs).length
  return read / keys.length >= ASSISTANT.readShare
}
