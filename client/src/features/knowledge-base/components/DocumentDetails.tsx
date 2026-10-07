// A document's details panel (KB-01): every detail, then its actions.
// Active: Edit details, Edit history (AC9) and Withdraw. Withdrawn: who and
// when (AC14), Reinstate and Edit history, but no Edit details (AC15). Withdraw
// and Reinstate both open components/StatusChangeDialog.tsx. Used by
// components/DocumentRow.tsx.
import type { ReactNode } from 'react'
import { Button, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import {
  calendarDate,
  countryName,
  dateTime,
  facilityName,
  fileSize,
  sourceLabel,
} from '../display'
import { DetailText } from './DetailText'

/** Returns one document's details and actions. */
export function DocumentDetails({
  id,
  document: d,
  onEdit,
  onHistory,
  onChangeStatus,
}: {
  id: string
  document: KnowledgeDocument
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
}) {
  const standard = d.sourceType !== 'marsh_report'
  return (
    <section id={id} className="kb-details" aria-label={`Details of ${d.title}`}>
      <dl className="kb-facts">
        <Fact label="Source type">
          <DetailText text={sourceLabel(d.sourceType)} />
        </Fact>
        <Fact label="Issuing body">
          <DetailText text={d.issuingBody} />
        </Fact>
        {standard && (
          <Fact label="Edition">
            <DetailText text={d.edition} />
          </Fact>
        )}
        <Fact label={standard ? 'Effective date' : 'Report date'} mono>
          <DetailText text={calendarDate(d.effectiveDate)} />
        </Fact>
        <Fact label="Country">
          <DetailText text={countryName(d.jurisdiction)} />
        </Fact>
        <Fact label="Facility type">
          <DetailText text={facilityName(d.facilityType)} />
        </Fact>
        <Fact label="File" mono>
          {d.fileName}
        </Fact>
        <Fact label="Size" mono>
          {fileSize(d.size)}
        </Fact>
        <Fact label="Uploaded" mono>
          {dateTime(d.uploadedAt)}
        </Fact>
        {d.withdrawn && (
          <>
            <Fact label="Withdrawn" mono>
              {dateTime(d.withdrawn.at)}
            </Fact>
            <Fact label="Withdrawn by">{d.withdrawn.by.name}</Fact>
          </>
        )}
      </dl>
      <div className="kb-details-actions">
        {d.withdrawn ? (
          <Button
            variant="tonal"
            size="sm"
            iconLeft={IconRegistry.action.reinstate}
            onClick={onChangeStatus}
          >
            Reinstate
          </Button>
        ) : (
          <Button variant="tonal" size="sm" iconLeft={IconRegistry.action.edit} onClick={onEdit}>
            Edit details
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconLeft={IconRegistry.object.history}
          onClick={onHistory}
        >
          Edit history
        </Button>
        {!d.withdrawn && (
          <Button
            variant="danger-tonal"
            size="sm"
            iconLeft={IconRegistry.action.withdraw}
            onClick={onChangeStatus}
          >
            Withdraw
          </Button>
        )}
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
