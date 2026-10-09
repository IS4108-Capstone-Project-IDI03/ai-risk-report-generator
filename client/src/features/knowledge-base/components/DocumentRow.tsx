// One document's row in the Documents table (KB-01) and, when open, its
// details row below: title, one status badge (Needs review is the button into
// the Review page), then View original. Country and facility type show in the
// details. The title is the disclosure button; the rest of the row also opens
// it, as an observation's row does, while its actions keep their job. Used by
// components/DocumentGroup.tsx.
import { Badge, Icon, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { calendarDate, needsReview, reviewReasons } from '../display'
import { DocumentDetails } from './DocumentDetails'
import { ReviewBadge } from './ReviewBadge'

/** Returns the document's row, plus its details row when open. */
export function DocumentRow({
  document: d,
  open,
  onToggle,
  onEdit,
  onHistory,
  onChangeStatus,
  onReview,
}: {
  document: KnowledgeDocument
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
  onReview: () => void
}) {
  const panel = `kb-details-${d.id}`
  return (
    <>
      <tr
        className={open ? 'kb-doc-row is-open' : 'kb-doc-row'}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a, button')) onToggle()
        }}
      >
        <td className="kb-col-toggle">
          <Icon name={open ? IconRegistry.action.expand : IconRegistry.action.forward} size={15} />
        </td>
        <td className="kb-col-doc">
          <button
            type="button"
            className="kb-toggle"
            aria-expanded={open}
            aria-controls={panel}
            onClick={onToggle}
          >
            <strong>{d.title}</strong>
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
        <td className="kb-col-status">
          {/* One badge. A document with any Unconfirmed detail is not
              searchable, so it is never shown as Active (IN-05). */}
          {d.withdrawn ? (
            <Badge tone="danger">Withdrawn</Badge>
          ) : needsReview(d) ? (
            <ReviewBadge title={d.title} onReview={onReview} />
          ) : (
            <Badge tone="low">Active</Badge>
          )}
        </td>
        <td className="kb-col-actions">
          <span className="kb-row-actions">
            <a
              className="kb-link"
              href={d.fileUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`View original of ${d.title}`}
            >
              View original
            </a>
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
