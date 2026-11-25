// One recent upload's row (IN-01): title and details, when it was uploaded, its status, and its
// icon actions (Retry for a failed or cancelled one, Stop while it is queued or processing, and
// the original). Used by components/UploadedDocuments.tsx. Calls UploadStatus.
import { IconAction, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import {
  calendarDate,
  dateTime,
  facilityName,
  needsReview,
  reviewReasons,
  SOURCE_LABELS,
} from '../display'
import { UploadStatus } from './UploadStatus'

/** Returns the table row for one recent upload. */
export function UploadedRow({
  document: d,
  first,
  firstReview,
  firstType,
  retrying,
  cancelling,
  onRetry,
  onStop,
  onReview,
  onStarted,
  onStartError,
}: {
  document: KnowledgeDocument
  // The table's first row, and the first Needs review and Type needed rows, which the
  // walkthrough points at (F-12).
  first: boolean
  firstReview: boolean
  firstType: boolean
  retrying?: boolean
  cancelling?: boolean
  onRetry: () => void
  onStop: () => void
  onReview: () => void
  onStarted: () => void
  onStartError: (reason: string | null) => void
}) {
  return (
    <tr data-walk={first ? 'knowledge-add.row-1' : undefined}>
      <td className="kb-cell-doc">
        <span className="kb-doc">
          <strong title={d.title}>{d.title}</strong>
          <small>
            {d.sourceType === 'marsh_report'
              ? `${SOURCE_LABELS[d.sourceType]} · ${facilityName(d.facilityType)} · ${calendarDate(d.effectiveDate)}`
              : [
                  // "NFPA 13" once the standard number is known (IN-07).
                  [d.issuingBody, d.standardNumber].filter(Boolean).join(' '),
                  d.edition && `${d.edition} Edition`,
                  d.sourceType ? SOURCE_LABELS[d.sourceType] : 'Source type unconfirmed',
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </small>
          {/* Why it needs review, under the title as in the Documents list (IN-07). */}
          {d.status === 'complete' && needsReview(d) && (
            <small className="kb-why">{reviewReasons(d).join(' · ')}</small>
          )}
        </span>
      </td>
      <td className="kb-cell-when" data-label="Uploaded">
        {dateTime(d.uploadedAt)}
      </td>
      <td className="kb-cell-state">
        <UploadStatus
          document={d}
          onReview={onReview}
          onStarted={onStarted}
          onStartError={onStartError}
          walk={{ review: firstReview, type: firstType }}
        />
      </td>
      <td className="cl-cell-actions">
        <span className="cl-row-actions cl-row-actions--always">
          {(d.status === 'failed' || d.status === 'cancelled') && (
            <IconAction icon="rotate-ccw" label="Retry" disabled={retrying} onClick={onRetry} />
          )}
          {(d.status === 'queued' || d.status === 'processing') && (
            <IconAction icon="x" label="Stop" disabled={cancelling} onClick={onStop} />
          )}
          {d.fileUrl && (
            <IconAction
              icon={IconRegistry.action.openExternal}
              label={`View original of ${d.title}`}
              tooltip="View original"
              href={d.fileUrl}
            />
          )}
        </span>
      </td>
    </tr>
  )
}
