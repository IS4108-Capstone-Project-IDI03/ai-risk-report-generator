// One open knowledge request (CB-07): who asked and when, the question as its heading, the
// engineer's message as a quote, the two ways to close it, and uploading a document for it
// (F-11), so the engineer can follow that document's ingestion. Used by screens/Requests.tsx.
import { useRef } from 'react'
import { Button, IconAction } from '../../../design-system'
import { formatWhen } from '../../notifications/formatWhen'
import type { KnowledgeGapRequest } from '../api'

/** Returns the list item for one open request; `focused` marks the one a notification opened. */
export function RequestRow({
  request: r,
  first,
  focused,
  onFill,
  onDismiss,
  onUpload,
}: {
  request: KnowledgeGapRequest
  // The list's first request, which the walkthrough points at (F-12).
  first: boolean
  focused: boolean
  onFill: () => void
  onDismiss: () => void
  onUpload: (file: File) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <li
      className="kb-request"
      id={`request-${r.id}`}
      data-focused={focused || undefined}
      data-walk={first ? 'knowledge-requests.row-1' : undefined}
    >
      <div className="kb-request-body">
        <p className="kb-request-meta">
          <span>{r.askedBy.name}</span>
          <time dateTime={r.createdAt}>{formatWhen(r.createdAt)}</time>
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
        <Button
          variant="primary"
          size="sm"
          pill
          iconLeft="check"
          data-walk={first ? 'knowledge-requests.row-1.fill' : undefined}
          onClick={onFill}
        >
          Mark filled
        </Button>
        <Button
          variant="secondary"
          size="sm"
          pill
          iconLeft="x"
          data-walk={first ? 'knowledge-requests.row-1.dismiss' : undefined}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
        <IconAction
          icon="upload"
          label="Upload a document"
          tooltip="Upload a document"
          onClick={() => picker.current?.click()}
        />
        <input
          ref={picker}
          type="file"
          hidden
          aria-label="Upload for this request"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.rtf,.odt"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Cleared, so choosing the same file again still uploads.
            e.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </div>
    </li>
  )
}
