// The banner above the Documents list naming the documents that need review
// (IN-05, IN-07): one is named in the title with a button to review it; several are
// listed (at most three by name) with a button that filters the list to them.
// Shown by screens/KnowledgeDocuments.tsx, a placeholder for app-wide notifications.
import { Button, Callout } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { reviewReasons } from '../display'

// Names beyond this become "and N more", so 20 documents don't fill the page.
const MAX_NAMED = 3

/** Returns the warning banner for documents that need review. */
export function ReviewBanner({
  documents,
  onReview,
  onShow,
}: {
  documents: KnowledgeDocument[]
  onReview: (document: KnowledgeDocument) => void
  onShow: () => void
}) {
  if (documents.length === 1) {
    const [only] = documents
    return (
      <Callout
        tone="warning"
        title={`${only.title} needs review`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => onReview(only)}>
            Review
          </Button>
        }
      >
        {only.match && <p className="kb-review-line">{reviewReasons(only).join(' · ')}</p>}
        <p className="kb-review-line">
          {only.match
            ? 'Compare it with the stored document and choose what to do. Until then, new reports cannot use it.'
            : 'Fill in its unconfirmed details, so new reports can refer to it.'}
        </p>
      </Callout>
    )
  }

  const named = documents.slice(0, MAX_NAMED)
  const rest = documents.length - named.length
  // "A and B", "A, B and C", or "A, B, C and 2 more"; names in bold so long
  // titles stay apart.
  const names = named.map((d, i) => (
    <span key={d.id}>
      {i === 0 ? '' : i < named.length - 1 || rest ? ', ' : ' and '}
      <b>{d.title}</b>
    </span>
  ))
  return (
    <Callout
      tone="warning"
      title={`${documents.length} documents need review`}
      actions={
        <Button variant="secondary" size="sm" onClick={onShow}>
          Show them
        </Button>
      }
    >
      <p className="kb-review-line">
        {names}
        {rest ? ` and ${rest} more` : ''}
      </p>
      <p className="kb-review-line">
        {documents.some((d) => d.match)
          ? 'Review them, so new reports can refer to them.'
          : 'Fill in their unconfirmed details, so new reports can refer to them.'}
      </p>
    </Callout>
  )
}
