// The Passage tab's body (CB-02 AC1): the passage text with the quoted words marked.
// Used by CitationPanel. The match comes from quoteSpan.ts.
import { quoteSpan } from './quoteSpan'

type Props = { text: string; quote: string }

/** The passage text, line breaks kept, with the quote in <mark> when it is found. */
export function PassageText({ text, quote }: Props) {
  const span = quoteSpan(quote, text)
  return (
    // Focusable, so a keyboard user can scroll a long passage.
    <p className="chat-passage-text" tabIndex={0} aria-label="Passage text">
      {span ? (
        <>
          {text.slice(0, span[0])}
          <mark>{text.slice(span[0], span[1])}</mark>
          {text.slice(span[1])}
        </>
      ) : (
        text
      )}
    </p>
  )
}
