// A document's details, the body of its details panel (KB-01): its status, why it needs review
// (with the way into Review), then every detail as label and value pairs in two columns, and the
// file's facts. A withdrawn document adds who withdrew it and when (AC14). Its actions are in
// components/DocumentActions.tsx, the panel's footer. Used by components/DocumentPanel.tsx.
import { Button, Callout, Chip, Fact, FactList, StatusPill } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import {
  calendarDate,
  countryName,
  dateTime,
  facilityName,
  fileSize,
  isDraft,
  needsReview,
  reviewReasons,
  sourceLabel,
} from '../display'
import { TIER_LABELS } from '../../settings/tiers'
import { Tip } from '../../help/Tip'
import { DetailText } from './DetailText'
import { DocumentStatus } from './DocumentStatus'

/** Returns one document's details. */
export function DocumentDetails({
  document: d,
  onReview,
  canManage,
}: {
  document: KnowledgeDocument
  // Opens its Review page (IN-07); admins only.
  onReview: () => void
  // Off for a risk engineer: no way into Review (IN-17).
  canManage: boolean
}) {
  const standard = d.sourceType !== 'marsh_report'
  const draft = isDraft(d)
  return (
    <section
      className="kb-details"
      aria-label={`Details of ${d.title}`}
      data-walk="knowledge.details"
    >
      <div className="kb-details-status">
        {d.withdrawn ? (
          <DocumentStatus status="withdrawn" />
        ) : draft ? (
          <StatusPill status="manual_draft" />
        ) : needsReview(d) ? (
          <DocumentStatus status="needs_review" />
        ) : (
          <DocumentStatus status="active" />
        )}
        {d.entryMethod === 'manual' && <Chip kind="code">Manual entry</Chip>}
      </div>

      {/* Why it is kept out of search, and the one way to fix that (IN-07). */}
      {needsReview(d) && (
        <Callout
          tone="warning"
          title="Not used until it is reviewed"
          actions={
            canManage ? (
              <Button variant="secondary" size="sm" pill onClick={onReview}>
                Review
              </Button>
            ) : undefined
          }
        >
          {reviewReasons(d).join(' · ')}
        </Callout>
      )}

      <FactList>
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
          {d.jurisdiction === null ? (
            <DetailText text={null} />
          ) : (
            <Chip kind="jurisdiction">{countryName(d.jurisdiction)}</Chip>
          )}
        </Fact>
        <Fact label="Facility type">
          {d.facilityType === null ? (
            <DetailText text={null} />
          ) : (
            <Chip kind="facility">{facilityName(d.facilityType)}</Chip>
          )}
        </Fact>
      </FactList>

      {d.withdrawn && (
        <FactList>
          <Fact label="Withdrawn">{dateTime(d.withdrawn.at)}</Fact>
          <Fact label="Withdrawn by">{d.withdrawn.by.name}</Fact>
          {d.newerEdition && (
            <Fact label="Newer edition" wide>
              {d.newerEdition.edition ?? d.newerEdition.title}
            </Fact>
          )}
        </FactList>
      )}

      {/* The file's facts, quiet, last (IN-12). A manual entry has no file to size (IN-18). */}
      <p className="kb-file-line">
        {d.entryMethod === 'manual' ? (
          <>
            {draft ? 'Started' : 'Entered'} {dateTime(d.uploadedAt)}
          </>
        ) : (
          <>
            {d.size !== null && <span className="kb-file-size">{fileSize(d.size)} · </span>}
            Uploaded {dateTime(d.uploadedAt)}
          </>
        )}
      </p>
    </section>
  )
}
