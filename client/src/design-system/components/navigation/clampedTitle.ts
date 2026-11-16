// A heading clamped to 2 lines (the page title, AS-06 round 9) keeps its full text one hover
// away, but only while it is really cut short: a `title` that repeats a heading shown in full is
// read twice by some screen readers and pops a pointless tooltip on every hover.
// Used by TopBar.tsx and features/assessments/AssessmentApp.tsx.
import type { PointerEvent } from 'react'

/**
 * Returns a pointer-enter handler that sets `text` as the element's hover title only while it is
 * clamped. Measured on hover, so it is right after a resize or a late font, and costs no layout
 * read on render.
 */
export const clampedTitle = (text: string | undefined) => (event: PointerEvent<HTMLElement>) => {
  const el = event.currentTarget
  if (text && el.scrollHeight > el.clientHeight + 1) el.title = text
  else el.removeAttribute('title')
}
