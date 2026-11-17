// Text with a search's words marked where they are (CP-13): the observation's
// text, a recording's transcript or a photo's description on the evidence
// views and the Observations list. A handwritten page's reading marks its
// own, beside its unsure words, by giving the ranges (PageTranscript.tsx).
import type { ReactNode } from 'react'
import { hitRanges, type Range } from '../evidenceSearch'

// The text with the search's words marked, or the ranges given.
export function HitText({
  text,
  words = [],
  ranges = hitRanges(text, words),
}: {
  text: string
  words?: readonly string[]
  ranges?: readonly Range[]
}) {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="ob-hit">
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}
