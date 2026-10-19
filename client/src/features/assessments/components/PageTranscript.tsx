import type { CSSProperties, ReactNode } from 'react'
import { Icon, IconRegistry } from '../../../design-system'

// Read out by a screen reader, not shown.
const hidden: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
}

// An uncertain word: underlined, not only coloured, so it reads without colour too.
const unsure: CSSProperties = {
  background: 'transparent',
  color: 'inherit',
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: 'var(--ai-fg)',
  textDecorationThickness: '2px',
  textUnderlineOffset: '3px',
}

// A handwritten page's text as transcribed (CP-19 AC8, AC9). The words are the
// engineer's, but the reading of them is a model's, so they sit behind the AI
// rule; each word it was unsure of is underlined, and how many there are is
// said above, to check against the page. Positions count UTF-16 units, as
// JavaScript slices strings.
export function PageTranscript({
  text,
  uncertain,
}: {
  text: string
  uncertain: [number, number][]
}) {
  const marks = [...uncertain].sort((a, b) => a[0] - b[0])
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of marks) {
    if (start < at || end > text.length) continue
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} style={unsure}>
        {text.slice(start, end)}
        <span style={hidden}> (unsure)</span>
      </mark>,
    )
    at = end
  }
  parts.push(text.slice(at))
  const count = parts.filter((p) => typeof p !== 'string').length
  return (
    <>
      {count > 0 && (
        <p
          style={{
            margin: '6px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '14px',
            color: 'var(--text-secondary)',
          }}
        >
          <Icon name={IconRegistry.evidence.uncertainty} size={14} color="var(--ai-fg)" />
          {count === 1
            ? '1 word unsure. Check it against the page.'
            : count + ' words unsure. Check them against the page.'}
        </p>
      )}
      <p
        style={{
          margin: '6px 0 0',
          paddingLeft: '12px',
          borderLeft: '2px solid var(--ai-border)',
          fontSize: '15px',
          lineHeight: '24px',
          color: 'var(--text-body)',
          maxWidth: '68ch',
          whiteSpace: 'pre-line',
          overflowWrap: 'anywhere',
        }}
      >
        {parts}
      </p>
    </>
  )
}
