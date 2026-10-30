// The request being closed, quoted at the top of the fill and dismiss dialogs (CB-07), so the
// admin can see what they are answering. Used by FillRequestDialog and DismissRequestDialog.
import type { KnowledgeGapRequest } from '../api'

/** Returns the quoted question (and message, if any) for a request dialog. */
export function RequestQuote({ request: r }: { request: KnowledgeGapRequest }) {
  return (
    <figure className="kb-request-quote">
      <figcaption>Question from {r.askedBy.name}</figcaption>
      <blockquote>{r.question}</blockquote>
      {r.message && <p>{r.message}</p>}
    </figure>
  )
}
