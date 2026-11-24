// The assessment-wide actions in the workspace header (CP-22 round 1): Version
// history, Details (AS-06 board 06) and Archive as one quiet pill group, icon
// and short word each, so they read at a glance on every tab. Rendered by AssessmentApp.tsx.
import { Icon } from '../../../design-system'
import { ReasonWrap } from '../../../design-system/components/feedback/ReasonBox'
import './assessment-actions.css'

export function AssessmentActions({
  onHistory,
  onDetails,
  onArchive,
  archiveBlocked,
}: {
  onHistory: () => void
  // Absent when the assessment has no saved record to show (a sample one).
  onDetails?: () => void
  // Absent when this engineer can't archive the assessment.
  onArchive?: () => void
  // Set on the practice assessment: Archive shows greyed out with this reason (F-12).
  archiveBlocked?: { title: string; text: string }
}) {
  return (
    <div className="aa-group" role="group" aria-label="Assessment" data-walk="assessment.actions">
      <button type="button" className="aa-item" title="Version history" onClick={onHistory}>
        <Icon name="history" size={16} />
        {'History'}
      </button>
      {!!onDetails && (
        <button type="button" className="aa-item" title="Assessment details" onClick={onDetails}>
          <Icon name="info" size={16} />
          {'Details'}
        </button>
      )}
      {!onArchive && !!archiveBlocked && (
        <ReasonWrap reason={archiveBlocked}>
          {(describedBy, onBlockedClick) => (
            <button
              type="button"
              className="aa-item"
              style={{ opacity: 0.45, cursor: 'not-allowed' }}
              aria-disabled
              aria-describedby={describedBy}
              onClick={onBlockedClick}
            >
              <Icon name="archive" size={16} />
              {'Archive'}
            </button>
          )}
        </ReasonWrap>
      )}
      {!!onArchive && (
        <button
          type="button"
          className="aa-item"
          title="Archive this assessment"
          onClick={onArchive}
        >
          <Icon name="archive" size={16} />
          {'Archive'}
        </button>
      )}
    </div>
  )
}
