// One open knowledge request (CB-07): who asked and when, the question as its heading, the
// engineer's message as a quote, and the two ways to close it. Used by screens/Requests.tsx.
import { Button } from '../../../design-system'
import { formatWhen } from '../../notifications/formatWhen'
import type { KnowledgeGapRequest } from '../api'

/** Returns the list item for one open request; `focused` marks the one a notification opened. */
export function RequestRow({
  request: r,
  focused,
  onFill,
  onDismiss,
}: {
  request: KnowledgeGapRequest
  focused: boolean
  onFill: () => void
  onDismiss: () => void
}) {
  return (
    <li className="kb-request" id={`request-${r.id}`} data-focused={focused || undefined}>
      <div className="kb-request-body">
        <p className="kb-request-meta">
          <span>{r.askedBy.name}</span>
          <time className="kb-mono" dateTime={r.createdAt}>
            {formatWhen(r.createdAt)}
          </time>
        </p>
        <h3 className="kb-request-question">{r.question}</h3>
        {r.message && (
          <figure className="kb-request-message">
            <figcaption>Message from {r.askedBy.name}</figcaption>
            <blockquote>{r.message}</blockquote>
          </figure>
        )}
      </div>
      <div className="kb-request-actions">
        <Button variant="tonal" size="sm" iconLeft="check" onClick={onFill}>
          Mark filled
        </Button>
        <Button variant="secondary" size="sm" iconLeft="x" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </li>
  )
}
