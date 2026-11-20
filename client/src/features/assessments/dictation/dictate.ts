// Dictation's gateway call and where its words go in a field (CP-27). Used by DictateButton.tsx.
import { request } from '../api'

/** Turns a short dictated clip into tidy text (CP-27). Throws GatewayError with the reason. */
export async function dictate(reference: string, clip: Blob): Promise<string> {
  const path = `/api/assessments/${encodeURIComponent(reference)}/dictation`
  return (await request<{ text: string }>('POST', path, clip)).data.text
}

/** `value` with `text` in place of characters `start` to `end` (the cursor or selection), a space
 * kept between it and the words either side, and where the cursor goes after it. */
export function withDictated(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = /^\w/.test(after) ? ' ' : ''
  const upTo = before + lead + text + trail
  return { value: upTo + after, caret: upTo.length }
}
