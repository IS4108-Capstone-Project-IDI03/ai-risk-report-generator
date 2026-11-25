// One document's row in the Documents table (KB-01) and, when open, its
// details row below: title, one status pill (Needs review is the button into
// the Review page), then the original's icon. Country and facility type show in the
// details. The title is the disclosure button; the rest of the row also opens
// it, as an observation's row does, while its actions keep their job. Used by
// components/DocumentGroup.tsx.
import { Chip, Icon, IconRegistry, StatusPill } from '../../../design-system'
import { RowAction } from '../../clients/components/RowAction'
import type { KnowledgeDocument } from '../api'
import { calendarDate, isDraft, needsReview, reviewReasons } from '../display'
import { DocumentDetails } from './DocumentDetails'
import { DocumentStatus } from './DocumentStatus'
import { ReviewBadge } from './ReviewBadge'

// Which of this row's parts the walkthroughs point at (F-12): the table's first row, the row whose
// details a walkthrough opens, and the Needs review row whose Review page it opens.
export type RowWalk = { row?: boolean; open?: boolean; review?: boolean }

/** Returns the document's row, plus its details row when open. */
export function DocumentRow({
  document: d,
  open,
  focused = false,
  onToggle,
  onEdit,
  onHistory,
  onChangeStatus,
  onDelete,
  onReview,
  onPassages,
  onPublish,
  onClauses,
  canManage,
  walk,
}: {
  document: KnowledgeDocument
  open: boolean
  // The document a notification opened (F-10): marked once, as a request is.
  focused?: boolean
  onToggle: () => void
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
  onDelete: () => void
  onReview: () => void
  onPassages: () => void
  // Publishes a manual draft (IN-18).
  onPublish: () => Promise<void>
  // Opens a manual document's clauses (IN-18).
  onClauses: () => void
  // Off for a risk engineer: no Review link, no actions in the details (IN-17).
  canManage: boolean
  walk?: RowWalk
}) {
  const panel = `kb-details-${d.id}`
  return (
    <>
      <tr
        id={`document-${d.id}`}
        data-focused={focused || undefined}
        data-walk={walk?.row ? 'knowledge.row-1' : undefined}
        className={open ? 'kb-doc-row is-open' : 'kb-doc-row'}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a, button')) onToggle()
        }}
      >
        <td className="kb-cell-toggle">
          <Icon name={open ? IconRegistry.action.expand : IconRegistry.action.forward} size={16} />
        </td>
        <td className="kb-cell-doc">
          <button
            type="button"
            className="kb-toggle"
            aria-expanded={open}
            aria-controls={panel}
            data-walk={walk?.open ? 'knowledge.row-1.open' : undefined}
            // A walkthrough's press (not a real tap) only opens the row: without this, stepping Back
            // and Next would press again and close it, and the step would lose its target.
            onClick={walk?.open ? (e) => (open && !e.isTrusted ? undefined : onToggle()) : onToggle}
          >
            <span className="kb-title-line">
              <strong title={d.title}>{d.title}</strong>
              {/* Typed in clause by clause, not uploaded (IN-18). */}
              {d.entryMethod === 'manual' && <Chip kind="code">Manual entry</Chip>}
            </span>
            <small>
              {d.edition
                ? [standardName(d), `${d.edition} Edition`].filter(Boolean).join(' · ')
                : d.sourceType === 'marsh_report'
                  ? `Report date ${calendarDate(d.effectiveDate)}`
                  : 'Edition unconfirmed'}
            </small>
            {/* Why it needs review, or which edition replaced it (IN-07). */}
            {needsReview(d) && <small className="kb-why">{reviewReasons(d).join(' · ')}</small>}
            {d.withdrawn && d.newerEdition && (
              <small className="kb-why-quiet">
                Replaced by{' '}
                {d.newerEdition.edition
                  ? `the ${d.newerEdition.edition} edition`
                  : d.newerEdition.title}
              </small>
            )}
          </button>
        </td>
        <td className="kb-cell-status" data-walk={walk?.row ? 'knowledge.status.row-1' : undefined}>
          {/* One pill. A document with any Unconfirmed detail is not
              searchable, so it is never shown as Active (IN-05). */}
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
          <span className="cl-row-actions cl-row-actions--always">
            {/* A manual document has no file to open (IN-18). */}
            {d.fileUrl && (
              <RowAction
                icon={IconRegistry.action.openExternal}
                label={`View original of ${d.title}`}
                tooltip="View original"
                href={d.fileUrl}
              />
            )}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="kb-details-row">
          <td colSpan={4}>
            <DocumentDetails
              id={panel}
              document={d}
              onEdit={onEdit}
              onHistory={onHistory}
              onChangeStatus={onChangeStatus}
              onDelete={onDelete}
              onPassages={onPassages}
              onPublish={onPublish}
              onClauses={onClauses}
              canManage={canManage}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// "NFPA 13", or just the issuing body while the number is unknown.
const standardName = (d: KnowledgeDocument) =>
  [d.issuingBody, d.standardNumber].filter(Boolean).join(' ') || null
