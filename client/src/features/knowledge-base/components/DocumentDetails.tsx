// A document's details panel (KB-01): every detail, then its actions.
// Active: Edit details, Edit history (AC9) and Withdraw. Needs review: no Edit
// details, since the row's Review button covers it (IN-07). Withdrawn: who and
// when (AC14), Reinstate and Edit history, but no Edit details (AC15);
// Reinstate is off while another edition is active (IN-07 AC15). Withdraw and
// Reinstate both open components/StatusChangeDialog.tsx. Delete (IN-12) opens
// components/DeleteDocumentDialog.tsx. A manual draft (IN-18) has only Publish
// and Delete draft: its details, history and passages wait until it is published.
// Used by components/DocumentRow.tsx.
import { useState, type ReactNode } from 'react'
import { Button, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import {
  calendarDate,
  countryName,
  dateTime,
  facilityName,
  fileSize,
  isDraft,
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
  onDelete,
  onPassages,
  onPublish,
  onClauses,
  canManage,
}: {
  id: string
  document: KnowledgeDocument
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
  onDelete: () => void
  // Opens the document's passages (IN-17); for everyone.
  onPassages: () => void
  // Publishes a manual draft (IN-18); settles once the gateway has answered.
  onPublish: () => Promise<void>
  // Opens a manual document's clauses (IN-18).
  onClauses: () => void
  // Off for a risk engineer: the details show, no action that changes them (IN-17).
  canManage: boolean
}) {
  const standard = d.sourceType !== 'marsh_report'
  const draft = isDraft(d)
  const [publishing, setPublishing] = useState(false)
  const publish = () => {
    setPublishing(true)
    onPublish().finally(() => setPublishing(false))
  }
  return (
    <section id={id} className="kb-details" aria-label={`Details of ${d.title}`}>
      <dl className="kb-facts">
        <Fact label="Source type">
          <DetailText text={sourceLabel(d.sourceType)} />
        </Fact>
        <Fact label="Issuing body">
          {/* A local standard may have none; that is not an Unconfirmed detail. */}
          <DetailText text={d.issuingBody ?? (d.sourceType === 'local_standard' ? 'None' : null)} />
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
        {/* A manual entry's clauses: still being entered, or amended once published (IN-18).
            Not once withdrawn: its PDF replaced it. */}
        {canManage && d.entryMethod === 'manual' && !d.withdrawn && (
          <Button
            variant={draft ? 'secondary' : 'tonal'}
            size="sm"
            iconLeft={IconRegistry.action.edit}
            onClick={onClauses}
          >
            {draft ? 'Continue editing' : 'Edit clauses'}
          </Button>
        )}
        {canManage && draft && (
          <Button variant="tonal" size="sm" iconLeft="check" loading={publishing} onClick={publish}>
            Publish
          </Button>
        )}
        {canManage && d.withdrawn && (
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
        {canManage && !draft && !d.withdrawn && !needsReview(d) && (
          <Button variant="tonal" size="sm" iconLeft={IconRegistry.action.edit} onClick={onEdit}>
            Edit details
          </Button>
        )}
        {!draft && (
          <>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={IconRegistry.object.history}
              onClick={onHistory}
            >
              Edit history
            </Button>
            <Button variant="ghost" size="sm" iconLeft="list" onClick={onPassages}>
              View passages
            </Button>
          </>
        )}
        {canManage && !draft && !d.withdrawn && (
          <Button
            variant="danger-tonal"
            size="sm"
            iconLeft={IconRegistry.action.withdraw}
            onClick={onChangeStatus}
          >
            Withdraw
          </Button>
        )}
        {/* The file's facts, then Delete, end the row together; in the list layout
            they share a second line, so Delete is never left on a line alone. */}
        <div className="kb-details-end">
          {/* The file's size and upload time are secondary, so they share the actions'
              row. Its name is left out: the title and View original stand for the file,
              and a long name pushed Delete onto a second line (IN-12). */}
          <span className="kb-file-line">
            {d.entryMethod === 'manual' ? (
              // No file to size: a manual entry was started, then published (IN-18).
              <>
                {draft ? 'Started' : 'Entered'} {dateTime(d.uploadedAt)}
              </>
            ) : (
              <>
                {/* Hidden on a phone, so the upload time and Delete still fit one line. */}
                {d.size !== null && <span className="kb-file-size">{fileSize(d.size)} · </span>}
                Uploaded {dateTime(d.uploadedAt)}
              </>
            )}
          </span>
          {/* Last in the row, set apart from Withdraw by the file's facts. Not while it
              is being ingested: Cancel covers that. A cited document gets a muted,
              locked Delete that explains instead (IN-12). */}
          {canManage && d.status !== 'queued' && d.status !== 'processing' && (
            <Button
              className="kb-delete"
              variant={d.cited ? 'secondary' : 'danger-outline'}
              size="sm"
              iconLeft={d.cited ? 'lock' : IconRegistry.action.discard}
              aria-label={d.cited ? 'Delete (cited by a report)' : undefined}
              style={d.cited ? { color: 'var(--text-muted)' } : undefined}
              onClick={onDelete}
            >
              {draft ? 'Delete draft' : 'Delete'}
            </Button>
          )}
        </div>
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
