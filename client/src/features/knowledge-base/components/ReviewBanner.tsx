// The banner above the Documents list naming the documents that need review
// (IN-05, IN-07): one is named in the title with a button to review it; several are
// listed (at most three by name) with a button that filters the list to them.
// Shown by screens/KnowledgeDocuments.tsx, a placeholder for app-wide notifications.
import { Button, Callout } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { reviewReasons } from '../display'

// Names beyond this become "and N more", so 20 documents don't fill the page.
const MAX_NAMED = 3

/** Returns the warning callout for documents that need review. */
export function ReviewBanner({
  documents,
  onReview,
  onShow,
}: {
  documents: KnowledgeDocument[]
  onReview: (document: KnowledgeDocument) => void
  onShow: () => void
}) {
  const [only] = documents
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
      title={
        documents.length === 1
          ? `${only.title} needs review`
          : `${documents.length} documents need review`
      }
      actions={
        documents.length === 1 ? (
          <Button variant="secondary" size="sm" pill onClick={() => onReview(only)}>
            Review
          </Button>
        ) : (
          <Button variant="secondary" size="sm" pill onClick={onShow}>
            Show them
          </Button>
        )
      }
    >
      <p className="kb-banner-line">
        {documents.length === 1 ? (
          reviewReasons(only).join(' · ')
        ) : (
          <>
            {names}
            {rest ? ` and ${rest} more` : ''}
          </>
        )}
      </p>
    </Callout>
  )
}
