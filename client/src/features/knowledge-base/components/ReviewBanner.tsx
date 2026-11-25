// The banner above the Documents list naming the documents that need review
// (IN-05, IN-07): one is named in the title with a button to review it; several are
// listed (at most three by name) with a button that filters the list to them.
// Shown by screens/KnowledgeDocuments.tsx, a placeholder for app-wide notifications.
import { Button, Icon, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { reviewReasons } from '../display'

// Names beyond this become "and N more", so 20 documents don't fill the page.
const MAX_NAMED = 3

/** Returns the amber banner for documents that need review. */
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
    <div className="kb-banner">
      <Icon name={IconRegistry.status.flagged.icon} size={18} />
      <div className="kb-banner-text">
        <p className="kb-banner-title">
          {documents.length === 1
            ? `${only.title} needs review`
            : `${documents.length} documents need review`}
        </p>
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
      </div>
      {documents.length === 1 ? (
        <Button variant="secondary" size="sm" pill onClick={() => onReview(only)}>
          Review
        </Button>
      ) : (
        <Button variant="secondary" size="sm" pill onClick={onShow}>
          Show them
        </Button>
      )}
    </div>
  )
}
