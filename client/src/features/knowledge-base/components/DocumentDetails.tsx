// A document's details panel (KB-01): every detail, then its actions.
// Active: Edit details, Edit history (AC9) and Withdraw. Needs review: no Edit
// details, since the row's Review button covers it (IN-07). Withdrawn: who and
// when (AC14), Reinstate and Edit history, but no Edit details (AC15);
// Reinstate is off while another edition is active (IN-07 AC15). Withdraw and
// Reinstate both open components/StatusChangeDialog.tsx. Used by
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
  needsReview,
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
          <Fact label="Standard number">
            <DetailText text={d.standardNumber} />
          </Fact>
        )}
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
        {d.withdrawn && d.newerEdition && (
          <Fact label="Newer edition">{d.newerEdition.edition ?? d.newerEdition.title}</Fact>
        )}
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
        {d.withdrawn && (
          <Button
            variant="tonal"
            size="sm"
            iconLeft={IconRegistry.action.reinstate}
            // Off while another edition is active: two are never active at once.
            disabled={!!d.reinstateBlockedBy}
            onClick={onChangeStatus}
          >
            Reinstate
          </Button>
        )}
        {!d.withdrawn && !needsReview(d) && (
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
        {/* The file's facts are secondary, so they share the actions' row
            instead of adding a second, half-empty row of details. */}
        <span className="kb-file-line">
          {d.fileName} · {fileSize(d.size)} · Uploaded {dateTime(d.uploadedAt)}
        </span>
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
