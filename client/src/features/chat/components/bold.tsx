// Bold for the document names the model wraps in **…** (CB-01), and section signs spelled
// out (CB-02). Used by CitedText.tsx for statements and cells, and by ../library.tsx for the
// FollowUp line.

// Everything else stays plain text (answer prompt: names only).
/** Returns the text with each **…** part as bold, and section signs spelled out. */
export function withBold(text: string) {
  return spellSections(text)
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

// Jesper (17 Oct): never show the section sign; "§ 8.15" reads "Section 8.15". Done on screen,
// not in the answer prompt, so it always holds and the tuned prompt (CB-01) stays as it is.
// Quoted words keep their § in the source panel: they must match the source.
/** Returns the text with "§§" as "Sections" and "§" as "Section". */
export function spellSections(text: string) {
  return text.replace(/§§\s*/g, 'Sections ').replace(/§\s*/g, 'Section ')
}
