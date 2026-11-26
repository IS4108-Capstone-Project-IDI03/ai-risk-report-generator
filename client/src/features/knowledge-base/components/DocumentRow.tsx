// One document's row in the Documents table (KB-01): the file's tile, its title and edition (or
// report date), one status pill (Needs review is the button into the Review page), then View
// original and the chevron. Country and facility type show in the details. The title is the
// button that opens the details panel; the rest of the row opens it too, while View original
// keeps its job. Used by components/DocumentGroup.tsx.
import { Chip, FileTile, Icon, IconAction, IconRegistry, StatusPill } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { editionLine, isDraft, needsReview, reviewReasons } from '../display'
import { DocumentStatus } from './DocumentStatus'
import { ReviewBadge } from './ReviewBadge'

// Which of this row's parts the walkthroughs point at (F-12): the table's first row, the row whose
// details a walkthrough opens, and the Needs review row whose Review page it opens.
export type RowWalk = { row?: boolean; open?: boolean; review?: boolean }

/** Returns the document's row. */
export function DocumentRow({
  document: d,
  open,
  focused = false,
  onOpen,
  onReview,
  canManage,
  walk,
}: {
  document: KnowledgeDocument
  // Its details panel is open.
  open: boolean
  // The document a notification opened (F-10): marked once, as a request is.
  focused?: boolean
  onOpen: () => void
  onReview: () => void
  // Off for a risk engineer: Needs review is a plain pill, not the way into Review (IN-17).
  canManage: boolean
  walk?: RowWalk
}) {
  return (
    <tr
      id={`document-${d.id}`}
      data-focused={focused || undefined}
      data-walk={walk?.row ? 'knowledge.row-1' : undefined}
      className={open ? 'kb-doc-row is-open' : 'kb-doc-row'}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a, button')) onOpen()
      }}
    >
      <td className="cl-cell-main">
        <button
          type="button"
          className="cl-open kb-open"
          aria-haspopup="dialog"
          data-walk={walk?.open ? 'knowledge.row-1.open' : undefined}
          onClick={onOpen}
        >
          {/* A manual entry has no file: the plain text tile (IN-18). */}
          <FileTile name={d.fileName ?? undefined} kind={d.fileName ? undefined : 'text'} />
          <span className="cl-lines">
            <span className="kb-title-line">
              <strong title={d.title}>{d.title}</strong>
              {/* Typed in clause by clause, not uploaded (IN-18). */}
              {d.entryMethod === 'manual' && <Chip kind="code">Manual entry</Chip>}
            </span>
            <span className="cl-line-2">{editionLine(d)}</span>
            {/* Why it needs review, or which edition replaced it (IN-07). */}
            {needsReview(d) && (
              <span className="cl-line-2 kb-why">{reviewReasons(d).join(' · ')}</span>
            )}
            {d.withdrawn && d.newerEdition && (
              <span className="cl-line-2">
                Replaced by{' '}
                {d.newerEdition.edition
                  ? `the ${d.newerEdition.edition} edition`
                  : d.newerEdition.title}
              </span>
            )}
          </span>
        </button>
      </td>
      <td className="kb-cell-status" data-walk={walk?.row ? 'knowledge.status.row-1' : undefined}>
        {/* One pill. A document with any Unconfirmed detail is not searchable, so it is never
            shown as Active (IN-05). */}
        {d.withdrawn ? (
          <DocumentStatus status="withdrawn" />
        ) : isDraft(d) ? (
          // A manual entry still being typed in (IN-18): Draft without the AI sparkles.
          <StatusPill status="manual_draft" />
        ) : needsReview(d) ? (
          canManage ? (
            <ReviewBadge
              title={d.title}
              onReview={onReview}
              walk={walk?.review ? 'knowledge.review-open' : undefined}
            />
          ) : (
            <DocumentStatus status="needs_review" />
          )
        ) : (
          <DocumentStatus status="active" />
        )}
      </td>
      <td className="cl-cell-actions">
        <span className="cl-row-actions kb-row-actions">
          {/* A manual document has no file to open (IN-18). */}
          {d.fileUrl && (
            <IconAction
              icon={IconRegistry.action.openExternal}
              label={`View original of ${d.title}`}
              tooltip="View original"
              href={d.fileUrl}
            />
          )}
        </span>
        <Icon name={IconRegistry.action.forward} size={16} className="kb-chevron" />
      </td>
    </tr>
  )
}
