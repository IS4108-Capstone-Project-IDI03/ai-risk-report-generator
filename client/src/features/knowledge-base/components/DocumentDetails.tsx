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
import { TIER_LABELS } from '../../settings/tiers'
import { Tip } from '../../help/Tip'
import { DetailText } from './DetailText'
import { RowIconButton } from './RowIconButton'

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
    <section
      id={id}
      className="kb-details"
      aria-label={`Details of ${d.title}`}
      data-walk="knowledge.details"
    >
      <dl className="kb-facts">
        <Fact label="Source type">
          <DetailText text={sourceLabel(d.sourceType)} />
        </Fact>
        <Fact label="Tier" help={<Tip id="knowledge.tier" />}>
          {d.tier ? (
            <>
              {TIER_LABELS[d.tier.value]}
              {d.tier.source === 'auto' && <span className="kb-tier-note"> (suggested)</span>}
            </>
          ) : (
            'Unranked'
          )}
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
        <Fact label={standard ? 'Effective date' : 'Report date'}>
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
            <Fact label="Withdrawn">{dateTime(d.withdrawn.at)}</Fact>
            <Fact label="Withdrawn by">{d.withdrawn.by.name}</Fact>
          </>
        )}
      </dl>
      <div className="kb-details-actions">
        {/* The file's facts, quiet, at the start; its name stays in the tooltip of View
            original's row, so a long name never pushes the actions around (IN-12). */}
        <span className="kb-file-line">
          {d.entryMethod === 'manual' ? (
            // No file to size: a manual entry was started, then published (IN-18).
            <>
              {draft ? 'Started' : 'Entered'} {dateTime(d.uploadedAt)}
            </>
          ) : (
            <>
              {d.size !== null && <span className="kb-file-size">{fileSize(d.size)} · </span>}
              Uploaded {dateTime(d.uploadedAt)}
            </>
          )}
        </span>
        <span className="kb-details-buttons">
          {/* A manual entry's clauses: still being entered, or amended once published (IN-18).
              Not once withdrawn: its PDF replaced it. These are the draft's main actions, so
              they keep their words. */}
          {canManage && d.entryMethod === 'manual' && !d.withdrawn && (
            <Button
              variant={draft ? 'secondary' : 'tonal'}
              size="sm"
              pill
              iconLeft={IconRegistry.action.edit}
              onClick={onClauses}
            >
              {draft ? 'Continue editing' : 'Edit clauses'}
            </Button>
          )}
          {canManage && draft && (
            <Button
              variant="primary"
              size="sm"
              pill
              iconLeft="check"
              loading={publishing}
              onClick={publish}
            >
              Publish
            </Button>
          )}
          {canManage && !draft && !d.withdrawn && !needsReview(d) && (
            <RowIconButton
              icon={IconRegistry.action.edit}
              label="Edit details"
              data-walk="knowledge.edit"
              onClick={onEdit}
            />
          )}
          {!draft && (
            <>
              <RowIconButton
                icon={IconRegistry.object.history}
                label="Edit history"
                data-walk="knowledge.history"
                onClick={onHistory}
              />
              <RowIconButton
                icon="list"
                label="View passages"
                data-walk="knowledge.passages"
                onClick={onPassages}
              />
            </>
          )}
          {canManage && d.withdrawn && (
            <RowIconButton
              icon={IconRegistry.action.reinstate}
              label="Reinstate"
              // Off while another edition is active: two are never active at once.
              disabledReason={
                d.reinstateBlockedBy
                  ? {
                      title: "Can't reinstate yet",
                      text: 'Another edition of this document is active. Withdraw it first.',
                    }
                  : undefined
              }
              onClick={onChangeStatus}
            />
          )}
          {canManage && !draft && !d.withdrawn && (
            <RowIconButton
              icon={IconRegistry.action.withdraw}
              label="Withdraw"
              data-walk="knowledge.withdraw"
              onClick={onChangeStatus}
            />
          )}
          {/* Last, set apart: Delete. Not while it is being read: Stop covers that. A cited
              document gets a locked Delete that explains instead (IN-12). */}
          {canManage && d.status !== 'queued' && d.status !== 'processing' && (
            <RowIconButton
              className="kb-delete"
              icon={d.cited ? 'lock' : IconRegistry.action.discard}
              label={d.cited ? 'Delete (cited by a report)' : draft ? 'Delete draft' : 'Delete'}
              tooltip={d.cited ? 'Delete (cited by a report)' : draft ? 'Delete draft' : 'Delete'}
              danger={!d.cited}
              onClick={onDelete}
            />
          )}
        </span>
      </div>
    </section>
  )
}

// `help` is a help tip (F-13) shown beside the label.
function Fact({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="kb-label">
        {help ? (
          <span className="kb-label-row">
            {label}
            {help}
          </span>
        ) : (
          label
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
