// Bold for the document names the model wraps in **…** (CB-01), and section signs spelled
// out (CB-02). Used by CitedText.tsx for statements and cells, and by ../library.tsx for the
// FollowUp line.

// Everything else stays plain text (answer prompt: names only).
// Each letter is its own span so it can fade in as it streams (chat.css .chat-ch). Keys are
// the letter's place in the text, so React keeps the letters already shown and only new
// ones animate.
function letters(part: string) {
  return [...part].map((c, i) => (
    <span className="chat-ch" key={i}>
      {c}
    </span>
  ))
}

/** Returns the text as letter spans, each **…** part bold, and section signs spelled out. */
export function withBold(text: string) {
  let spelled = spellSections(text)
  // A name still streaming has its opening ** only: close it, so it shows bold as it types
  // instead of as raw asterisks that then jump to bold.
  if ((spelled.match(/\*\*/g) ?? []).length % 2) spelled += '**'
  return spelled
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{letters(part)}</strong> : letters(part)))
}

// Jesper (17 Oct): never show the section sign; "§ 8.15" reads "Section 8.15". Done on screen,
// not in the answer prompt, so it always holds and the tuned prompt (CB-01) stays as it is.
// Quoted words keep their § in the source panel: they must match the source.
/** Returns the text with "§§" as "Sections" and "§" as "Section". */
export function spellSections(text: string) {
  return text.replace(/§§\s*/g, 'Sections ').replace(/§\s*/g, 'Section ')
}
