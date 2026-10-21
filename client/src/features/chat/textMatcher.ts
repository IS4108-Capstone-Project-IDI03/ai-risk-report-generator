// Test helper: finds text that the chat splits into per-word spans (UI/UX polish, part 1).
// Used by citedAnswer.test.tsx and knowledgeAssistant.test.tsx.
import type { Matcher } from '@testing-library/react'

/** Returns a matcher for the innermost element whose whole text matches `want`. */
export function phrase(want: string | RegExp): Matcher {
  const ok = (el: Element) =>
    typeof want === 'string' ? el.textContent?.trim() === want : want.test(el.textContent ?? '')
  return (_, el) => !!el && ok(el) && ![...el.children].some(ok)
}
