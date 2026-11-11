// The assessment-wide actions in the workspace header (CP-22 round 1): Version
// history, Details (AS-06 board 06) and Archive as one quiet pill group, icon
// and short word each, so they read at a glance on every tab. Rendered by AssessmentApp.tsx.
import { Icon } from '../../../design-system'
import './assessment-actions.css'

export function AssessmentActions({
  onHistory,
  onDetails,
  onArchive,
}: {
  onHistory: () => void
  // Absent when the assessment has no saved record to show (a sample one).
  onDetails?: () => void
  // Absent when this engineer can't archive the assessment.
  onArchive?: () => void
}) {
  return (
    <div className="aa-group" role="group" aria-label="Assessment">
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
