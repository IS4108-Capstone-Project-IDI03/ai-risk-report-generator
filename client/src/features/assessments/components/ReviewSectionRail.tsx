import { Badge, ProgressBar } from '../../../design-system'
import type { ReviewSection } from '../api'
import { completionLabel, plural, REVIEW_BADGE } from '../reviewDisplay'

// The section navigation of the review workspace (RV-01): sections 7-12, each
// with how much of it the draft writes (AC5) and where it stands in review
// (AC6). Selecting one changes the draft and the source panel together.
export function ReviewSectionRail({
  sections,
  selected,
  onSelect,
  style,
}: {
  sections: ReviewSection[]
  selected: string
  onSelect: (id: string) => void
  style: React.CSSProperties
}) {
  const drafted = sections.filter((s) => s.draft).length
  const flagged = sections.filter((s) => s.review.state === 'needs_review').length
  return (
    <nav aria-label="Report sections" className="om-scroll" style={style}>
      <p className="rv-label rv-rail-head">Sections</p>
      <div className="rv-rail-progress">
        <ProgressBar
          value={Math.round((drafted / sections.length) * 100)}
          label={`${drafted} of ${plural(sections.length, 'section')} drafted`}
          tone="primary"
        />
        {flagged > 0 && (
          <p className="rv-muted">
            {plural(flagged, 'section')} need{flagged === 1 ? 's' : ''} review
          </p>
        )}
      </div>
      <ul className="rv-rail-list">
        {sections.map((s) => {
          const badge = REVIEW_BADGE[s.review.state]
          return (
            <li key={s.id}>
              <button
                type="button"
                className="rv-rail-row"
                aria-current={s.id === selected ? 'true' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className="rv-rail-number">{s.id}</span>
                <span className="rv-rail-body">
                  <span className="rv-rail-title">{s.title}</span>
                  <span className="rv-rail-states">
                    <span className="rv-rail-completion">{completionLabel(s.completion)}</span>
                    <Badge tone={badge.tone} icon={badge.icon}>
                      {badge.label}
                    </Badge>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="rv-rail-legend">
        A section needs review when a statement is unsupported, a source it cites has been
        withdrawn, or observations changed after it was drafted.
      </p>
    </nav>
  )
}
