import { Badge, ProgressBar } from '../../../design-system'
import type { ReviewSection, Summary } from '../api'
import { completionLabel, plural, REVIEW_BADGE } from '../reviewDisplay'

// The section navigation of the review workspace (RV-01): sections 7-12, each
// with how much of it the draft writes (AC5) and where it stands in review
// (AC6). Selecting one changes the draft and the source panel together.
// Section 3's OFIs (GN-05) come first, with how many are in the report.
// Sections 1 and 2 lead the rail and Appendix A ends it (GN-07).
export function ReviewSectionRail({
  sections,
  selected,
  onSelect,
  inReport,
  summary,
  style,
}: {
  sections: ReviewSection[]
  selected: string
  onSelect: (id: string) => void
  // Accepted OFIs, for section 3's row.
  inReport: number
  // Section 2's state, for its row; null until loaded.
  summary: Summary['executiveSummary'] | null
  style: React.CSSProperties
}) {
  // One rail row: its number, title and state badges.
  const row = (id: string, number: string, title: string, states: React.ReactNode) => (
    <li key={id}>
      <button
        type="button"
        className="rv-rail-row"
        aria-current={selected === id ? 'true' : undefined}
        onClick={() => onSelect(id)}
      >
        <span className="rv-rail-number">{number}</span>
        <span className="rv-rail-body">
          <span className="rv-rail-title">{title}</span>
          <span className="rv-rail-states">{states}</span>
        </span>
      </button>
    </li>
  )
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
        {row(
          '1',
          '1',
          'Purpose and Scope',
          <Badge tone="low" icon="check">
            From assessment details
          </Badge>,
        )}
        {row(
          '2',
          '2',
          'Executive Summary',
          !summary ? null : summary.staleSections.length ? (
            <Badge tone="moderate" icon="triangle-alert">
              Out of date
            </Badge>
          ) : summary.draft ? (
            <Badge tone="ai" icon="sparkles">
              AI draft
            </Badge>
          ) : (
            <Badge tone="neutral" icon="circle-dashed">
              {summary.missing.length
                ? `Needs ${plural(summary.missing.length, 'section')}`
                : 'Not drafted'}
            </Badge>
          ),
        )}
        <li>
          <button
            type="button"
            className="rv-rail-row"
            aria-current={selected === '3' ? 'true' : undefined}
            onClick={() => onSelect('3')}
          >
            <span className="rv-rail-number">3</span>
            <span className="rv-rail-body">
              <span className="rv-rail-title">Opportunities for Improvement</span>
              <span className="rv-rail-states">
                {inReport > 0 ? (
                  <Badge tone="low" icon="check">
                    {inReport} in the report
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon="circle-dashed">
                    None in the report
                  </Badge>
                )}
              </span>
            </span>
          </button>
        </li>
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
        {row('A', 'A', 'Site Photos', <span className="rv-rail-completion">Appendix A</span>)}
      </ul>
      <p className="rv-rail-legend">
        A section needs review when a statement is unsupported, a source it cites has been
        withdrawn, or observations changed after it was drafted.
      </p>
    </nav>
  )
}
