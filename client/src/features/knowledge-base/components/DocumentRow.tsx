// One document's row in the Documents table (KB-01) and, when open, its
// details row below. The title is the disclosure button; the rest of the row
// also opens it, as an observation's row does, while its View original link
// keeps its job. Used by components/DocumentGroup.tsx.
import type { ReactNode } from 'react'
import { Badge, Button, Icon, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import {
  calendarDate,
  countryName,
  dateTime,
  facilityName,
  fileSize,
  SOURCE_LABELS,
} from '../display'

/** Returns the document's row, plus its details row when open. */
export function DocumentRow({
  document: d,
  open,
  onToggle,
  onEdit,
  onHistory,
}: {
  document: KnowledgeDocument
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onHistory: () => void
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
                ? `${d.issuingBody} · ${d.edition} Edition`
                : `Report date ${calendarDate(d.effectiveDate)}`}
            </small>
          </button>
        </td>
        <td className="kb-col-country">{countryName(d.jurisdiction)}</td>
        <td className="kb-col-facility">{facilityName(d.facilityType)}</td>
        <td className="kb-col-status">
          <Badge tone="low">Active</Badge>
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
            <DocumentDetails id={panel} document={d} onEdit={onEdit} onHistory={onHistory} />
          </td>
        </tr>
      )}
    </>
  )
}

// Every detail of one document, with its two actions: Edit details, and its
// edit history (AC9) behind a button, like the assessment's Version history.
function DocumentDetails({
  id,
  document: d,
  onEdit,
  onHistory,
}: {
  id: string
  document: KnowledgeDocument
  onEdit: () => void
  onHistory: () => void
}) {
  const standard = d.sourceType !== 'marsh_report'
  return (
    <section id={id} className="kb-details" aria-label={`Details of ${d.title}`}>
      <dl className="kb-facts">
        <Fact label="Source type">{SOURCE_LABELS[d.sourceType]}</Fact>
        <Fact label="Issuing body">{d.issuingBody}</Fact>
        {standard && <Fact label="Edition">{d.edition}</Fact>}
        <Fact label={standard ? 'Effective date' : 'Report date'} mono>
          {calendarDate(d.effectiveDate)}
        </Fact>
        <Fact label="Country">{countryName(d.jurisdiction)}</Fact>
        <Fact label="Facility type">{facilityName(d.facilityType)}</Fact>
        <Fact label="File" mono>
          {d.fileName}
        </Fact>
        <Fact label="Size" mono>
          {fileSize(d.size)}
        </Fact>
        <Fact label="Uploaded" mono>
          {dateTime(d.uploadedAt)}
        </Fact>
      </dl>
      <div className="kb-details-actions">
        <Button variant="tonal" size="sm" iconLeft={IconRegistry.action.edit} onClick={onEdit}>
          Edit details
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={IconRegistry.object.history}
          onClick={onHistory}
        >
          Edit history
        </Button>
      </div>
    </section>
  )
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div>
      <dt className="kb-label">{label}</dt>
      <dd className={mono ? 'kb-mono' : undefined}>{children}</dd>
    </div>
  )
}
