// The Needs review badge as the way into a document's Review page (IN-07):
// one control where there used to be a badge plus a Review button. It keeps
// the badge's look (amber, flag icon) and adds an arrow and a hover tint so it
// reads as clickable. Used by components/DocumentRow.tsx and
// components/UploadedDocuments.tsx.
import { Icon, IconRegistry } from '../../../design-system'

/** Returns the Needs review badge that opens the document's Review page. */
export function ReviewBadge({ title, onReview }: { title: string; onReview: () => void }) {
  return (
    <button
      type="button"
      className="kb-review-badge"
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
