// A statement's or table cell's text with its citation markers (CB-01). Document names the
// model wrapped in **…** show in bold. The markers follow a no-break space, so a number
// never starts a line on its own. Used by ../library.tsx.
import type { ReactNode } from 'react'

const NO_BREAK_SPACE = ' '

// Bold for **…**; everything else stays plain text (answer prompt: names only).
function withBold(text: string) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

/** Renders the text, then a no-break space and its markers held together. */
export function CitedText({ text, cites }: { text: string; cites: ReactNode }) {
  return (
    <>
      {withBold(text)}
      {NO_BREAK_SPACE}
      <span className="chat-cites">{cites}</span>
    </>
  )
}
