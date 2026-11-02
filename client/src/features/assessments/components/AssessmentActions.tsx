// The assessment-wide actions in the workspace header (CP-22 round 1): Version
// history and Archive as one quiet pill group, icon and short word each, so
// both read at a glance on every tab. Rendered by AssessmentApp.tsx.
import { Icon } from '../../../design-system'
import './assessment-actions.css'

export function AssessmentActions({
  onHistory,
  onArchive,
}: {
  onHistory: () => void
  // Absent when this engineer can't archive the assessment.
  onArchive?: () => void
}) {
  return (
    <div className="aa-group" role="group" aria-label="Assessment">
      <button type="button" className="aa-item" title="Version history" onClick={onHistory}>
        <Icon name="history" size={16} />
        {'History'}
      </button>
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
