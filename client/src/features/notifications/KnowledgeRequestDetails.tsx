// The expanded body of a knowledge request notification (CB-07): the question, then the
// engineer's message, the documents added or the dismissal reason, each under its own label.
// Reads the parts the gateway stores in `context` (server/src/services/knowledge-gap.service.ts).
// Shown by NotificationRow.tsx in place of the plain details text.
import { Button } from '../../design-system'
import type { Notification } from './api'
import { formatWhen } from './formatWhen'

type Added = { title: string; uploadedAt: string }

// The filled request's documents, or none if the field is missing or unreadable.
function addedDocuments(raw: string | undefined): Added[] {
  try {
    return raw ? (JSON.parse(raw) as Added[]) : []
  } catch {
    return []
  }
}

/** Returns the labelled parts of a knowledge request notification, with its next step. */
export function KnowledgeRequestDetails({
  context,
  onOpen,
}: {
  context: NonNullable<Notification['context']>
  onOpen: () => void
}) {
  const { question, message, askedBy, status, reason } = context
  const documents = addedDocuments(context.documents)
  return (
    <div className="notif-request">
      <section>
        <h4>Question</h4>
        <p className="notif-request-question">{question}</p>
      </section>
      {message && (
        <section>
          <h4>Message from {askedBy}</h4>
          <blockquote>{message}</blockquote>
        </section>
      )}
      {status === 'filled' && documents.length > 0 && (
        <section>
          <h4>Added</h4>
          <ul>
            {documents.map((d) => (
              <li key={d.title + d.uploadedAt}>
                <span>{d.title}</span>
                <time dateTime={d.uploadedAt}>{formatWhen(d.uploadedAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      {status === 'dismissed' && reason && (
        <section>
          <h4>Reason</h4>
          <blockquote>{reason}</blockquote>
        </section>
      )}
      {status !== 'dismissed' && (
        <Button
          variant="secondary"
          size="sm"
          iconRight="arrow-right"
          onClick={onOpen}
          style={{ justifySelf: 'start' }}
        >
          {status === 'filled' ? 'Ask again' : 'Go to request'}
        </Button>
      )}
    </div>
  )
}
