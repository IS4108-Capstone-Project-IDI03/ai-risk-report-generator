// Bold for the document names the model wraps in **…** (CB-01). Used by CitedText.tsx for
// statements and cells, and by ../library.tsx for the FollowUp line.

// Everything else stays plain text (answer prompt: names only).
/** Returns the text with each **…** part as bold. */
export function withBold(text: string) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}
