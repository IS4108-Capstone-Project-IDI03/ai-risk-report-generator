// The Needs review badge as the way into a document's Review page (IN-07):
// one control where there used to be a badge plus a Review button. It keeps
// the badge's look (amber, flag icon) and adds an arrow and a hover tint so it
// reads as clickable. Used by components/DocumentRow.tsx and
// components/UploadedDocuments.tsx.
import { Icon, IconRegistry } from '../../../design-system'

/** Returns the Needs review badge that opens the document's Review page. */
export function ReviewBadge({
  title,
  onReview,
  walk,
}: {
  title: string
  onReview: () => void
  // The badge's data-walk tag (F-12).
  walk?: string
}) {
  return (
    <button
      type="button"
      className="kb-review-badge"
      data-walk={walk}
      // Starts with the visible words, so speech input ("click Needs review") finds it.
      aria-label={`Needs review: ${title}`}
      onClick={onReview}
    >
      <Icon name={IconRegistry.status.flagged.icon} size={12} />
      Needs review
      <Icon name={IconRegistry.action.forward} size={12} />
    </button>
  )
}
