import { Badge, Button, IconRegistry, ProgressBar } from '../../../design-system'
import type { FindingCounts, ReviewSection, Summary } from '../api'
import { completionLabel, plural, reportProgress, REVIEW_BADGE } from '../reviewDisplay'

// The review summary (RV-02 AC9): the saved drafts' findings across the
// report by decision, as the gateway counted them from the saved decisions.
function ReviewSummary({ summary }: { summary: FindingCounts }) {
  return (
    <section aria-label="Review summary" className="rv-summary">
      <p className="rv-label">Review summary</p>
      <dl className="rv-summary-grid">
        {(
          [
            ['accepted', 'Accepted'],
            ['edited', 'Edited'],
            ['rejected', 'Rejected'],
            ['pending', 'Pending'],
          ] as const
        ).map(([state, label]) => (
          <div key={state}>
            <dt>{label}</dt>
            <dd>{summary[state]}</dd>
          </div>
        ))}
      </dl>
      <p className="rv-muted">
        {summary.total
          ? `${summary.total - summary.pending} of ${plural(summary.total, 'finding')} decided`
          : 'No findings drafted yet'}
      </p>
    </section>
  )
}

// The section navigation of the review workspace (RV-01): sections 7-12, each
// with how much of it the draft writes (AC5) and where it stands in review
// (AC6), and the review summary above them (RV-02). Selecting one changes the
// draft and the source panel together. Section 3's OFIs (GN-05) come first,
// with how many are in the report.
// Sections 1 and 2 lead the rail and Appendix A ends it (GN-07). Edit
// document, for the assigned engineer, opens the whole report as one
// document (RV-08).
export function ReviewSectionRail({
  sections,
  summary,
  regenerating = new Set(),
  selected,
  onSelect,
  inReport,
  executiveSummary,
  onEditDocument,
  editPending = false,
  style,
}: {
  sections: ReviewSection[]
  summary?: FindingCounts
  // Sections being regenerated now.
  regenerating?: Set<string>
  selected: string
  onSelect: (id: string) => void
  // Accepted OFIs, for section 3's row.
  inReport: number
  // Section 2's state, for its row; null until loaded (GN-07).
  executiveSummary: Summary['executiveSummary'] | null
  // Left out where the viewer may not edit.
  onEditDocument?: () => void
  // The document's last changes are still being read back: opening it again
  // waits, so it opens on them.
  editPending?: boolean
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
  // Over all 12 of Marsh's sections, not only those with a draft of their own.
  const progress = reportProgress({
    summaryDrafted: !!executiveSummary?.draft,
    ofisAccepted: inReport,
    sectionsDrafted: drafted,
  })
  const flagged = sections.filter((s) => s.review.state === 'needs_review').length
  const reviewed = sections.filter((s) => s.review.state === 'reviewed').length
  return (
    <nav aria-label="Report sections" className="om-scroll" style={style}>
      {onEditDocument && (
        <div className="rv-rail-edit">
          <Button
            variant="tonal"
            size="sm"
            iconLeft={IconRegistry.object.report}
            fullWidth
            disabled={editPending}
            onClick={onEditDocument}
          >
            Edit document
          </Button>
          <p className="rv-muted">Write and revise any section, drafted or not, in one document.</p>
        </div>
      )}
      {summary && <ReviewSummary summary={summary} />}
      <p className="rv-label rv-rail-head">Sections</p>
      <div className="rv-rail-progress">
        <ProgressBar
          value={progress.percent}
          label={`${progress.done} of ${plural(progress.total, 'section')} drafted`}
          tone="primary"
        />
        {reviewed > 0 && (
          <p className="rv-muted">
            {reviewed} of {drafted} reviewed
          </p>
        )}
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
          !executiveSummary ? null : executiveSummary.staleSections.length ? (
            <Badge tone="moderate" icon="triangle-alert">
              Out of date
            </Badge>
          ) : executiveSummary.draft ? (
            <Badge tone="ai" icon="sparkles">
              AI draft
            </Badge>
          ) : (
            <Badge tone="neutral" icon="circle-dashed">
              {executiveSummary.missing.length
                ? `Needs ${plural(executiveSummary.missing.length, 'section')}`
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
                    {/* Changed in the document while still flagged (RV-08 AC12). */}
                    {s.review.editedInDocument && s.review.state !== 'edited' && (
                      <Badge tone={REVIEW_BADGE.edited.tone} icon={REVIEW_BADGE.edited.icon}>
                        {REVIEW_BADGE.edited.label}
                      </Badge>
                    )}
                    {regenerating.has(s.id) ? (
                      <Badge tone="ai" icon={IconRegistry.action.regenerate}>
                        Regenerating
                      </Badge>
                    ) : (
                      s.replacement && (
                        <Badge tone="ai" icon={IconRegistry.action.regenerate}>
                          Replacement ready
                        </Badge>
                      )
                    )}
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
        withdrawn, or observations changed after it was drafted. It is reviewed once every finding
        is accepted, edited or rejected, and edited by you once you change or write it in the
        document.
      </p>
    </nav>
  )
}
