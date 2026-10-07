// One document's row in the Documents table (KB-01) and, when open, its
// details row below. The title is the disclosure button; the rest of the row
// also opens it, as an observation's row does, while its View original link
// keeps its job. Used by components/DocumentGroup.tsx.
import { Badge, Icon, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { calendarDate, countryName, facilityName, needsReview } from '../display'
import { DetailText } from './DetailText'
import { DocumentDetails } from './DocumentDetails'

/** Returns the document's row, plus its details row when open. */
export function DocumentRow({
  document: d,
  open,
  onToggle,
  onEdit,
  onHistory,
  onChangeStatus,
}: {
  document: KnowledgeDocument
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
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
                ? [d.issuingBody, `${d.edition} Edition`].filter(Boolean).join(' · ')
                : d.sourceType === 'marsh_report'
                  ? `Report date ${calendarDate(d.effectiveDate)}`
                  : 'Edition unconfirmed'}
            </small>
          </button>
        </td>
        <td className="kb-col-country">
          <DetailText text={countryName(d.jurisdiction)} />
        </td>
        <td className="kb-col-facility">
          <DetailText text={facilityName(d.facilityType)} />
        </td>
        <td className="kb-col-status">
          {/* A document with any Unconfirmed detail is not searchable, so it is
              never shown as Active (IN-05). */}
          <span className="kb-badges">
            {d.withdrawn && <Badge tone="danger">Withdrawn</Badge>}
            {needsReview(d) && (
              <Badge tone="moderate" icon={IconRegistry.status.flagged.icon}>
                Needs review
              </Badge>
            )}
            {!d.withdrawn && d.unconfirmed.length === 0 && <Badge tone="low">Active</Badge>}
          </span>
        </td>
        <td className="kb-col-original">
          <a
            className="kb-link"
            href={d.fileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View original of ${d.title}`}
          >
            View original
          </a>
        </td>
      </tr>
      {open && (
        <tr className="kb-details-row">
          <td colSpan={6}>
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
