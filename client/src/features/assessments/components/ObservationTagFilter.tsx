// The tag filter row above the Observations list (CP-36): All, Recommendation, Info request and each
// label in use, with counts. Filters the list client-side. Rendered by screens/Observations.tsx.
import { Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../kind-picker.css'

/** Returns the filter row, or nothing while no tag is in use. */
export function ObservationTagFilter({ v }: { v: AssessmentWorkflow }) {
  if (v.obsTagChips.length < 2) return null
  return (
    <div className="kp-filter" role="group" aria-label="Filter by tag">
      {v.obsTagChips.map((c) => (
        <button
          key={c.value}
          type="button"
          className="kp-chip"
          aria-pressed={v.obsTag === c.value}
          onClick={() => v.setObsTag(c.value)}
        >
          {c.icon && <Icon name={c.icon} size={13} />}
          {c.label} <span className="kp-count">{c.count}</span>
        </button>
      ))}
    </div>
  )
}
