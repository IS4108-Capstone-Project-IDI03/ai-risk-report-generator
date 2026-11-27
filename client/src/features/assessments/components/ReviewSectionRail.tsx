import { useEffect, useRef } from 'react'
import {
  Badge,
  HelpTip,
  IconRegistry,
  ProgressBar,
  RowMark,
  SectionRow,
} from '../../../design-system'
import type { FindingCounts, ReviewSection, Summary } from '../api'
import { completionLabel, plural, reportProgress, REVIEW_BADGE } from '../reviewDisplay'

// F-12 walkthrough tags for the rows the Review walkthroughs open or point at.
const ROW_WALK: Record<string, string> = {
  '3': 'review.rail.section-3',
  '4': 'review.rail.section-4',
  '5': 'review.rail.section-5',
  '7': 'review.rail.section-7',
  '9': 'review.rail.section-9',
}

// The review summary (RV-02 AC9): the saved drafts' findings across the report by decision, as
// the gateway counted them from the saved decisions. Four quiet counts in one strip.
function ReviewSummary({ summary }: { summary: FindingCounts }) {
  return (
    <section aria-label="Review summary" className="rv-summary">
      <dl className="rv-summary-grid">
        {(
          [
            ['accepted', 'Accepted'],
            ['edited', 'Edited'],
            ['rejected', 'Rejected'],
            ['pending', 'Pending'],
          ] as const
        ).map(([state, label]) => (
          <div key={state} data-state={state}>
            <dt>{label}</dt>
            <dd data-zero={summary[state] ? undefined : ''}>{summary[state]}</dd>
          </div>
        ))}
      </dl>
      <p className="rv-summary-line">
        {summary.total
          ? `${summary.total - summary.pending} of ${plural(summary.total, 'finding')} decided`
          : 'No findings drafted yet'}
      </p>
    </section>
  )
}

// The report outline of the review workspace (RV-01): where the report stands (drafted,
// reviewed, findings decided), then every part as a row of its number, name and one line of
// state. Selecting one changes the draft and the source panel together. Section 3's OFIs (GN-05)
// show how many are in the report; Sections 1 and 2 lead and Appendix A ends it (GN-07).
// The rows are the design system's section rows, as on Generation and in the document editor.
export function ReviewSectionRail({
  sections,
  summary,
  regenerating = new Set(),
  redrafting = new Set(),
  hideOpening = false,
  draftedParts,
  selected,
  onSelect,
  inReport,
  executiveSummary,
  style,
}: {
  sections: ReviewSection[]
  summary?: FindingCounts
  // Sections being regenerated now.
  regenerating?: Set<string>
  // Of those, the ones a drafting run is redrafting (GN-13): same line, "Redrafting".
  redrafting?: Set<string>
  // Leaves out Sections 1 and 2 and Appendix A until the report is drafted (GN-13).
  hideOpening?: boolean
  // How many of the 11 parts the gateway counts as drafted (GN-13), so this rail and
  // Generation always show the same number. Left out, the rail counts for itself.
  draftedParts?: number
  selected: string
  onSelect: (id: string) => void
  // Accepted OFIs, for section 3's row.
  inReport: number
  // Section 2's state, for its row; null until loaded (GN-07).
  executiveSummary: Summary['executiveSummary'] | null
  // Extra layout from the host, if any; the rail's own look is `.rv-rail` (review.css).
  style?: React.CSSProperties
}) {
  // The open part's row kept in view when the stepper moves past the rows shown. Only where the
  // outline scrolls by itself: stacked under the draft, moving the page would pull it off the part.
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const box = nav.current
    const row = box?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!box || !row || box.scrollHeight <= box.clientHeight) return
    const top = row.offsetTop - box.offsetTop
    if (top < box.scrollTop + 16 || top + row.offsetHeight > box.scrollTop + box.clientHeight - 16)
      box.scrollTo?.({ top: top - box.clientHeight / 3 })
  }, [selected])
  const drafted = sections.filter((s) => s.draft).length
  // Over the 11 counted parts (Sections 2-12), not only those with a draft of their own.
  const counted = reportProgress({
    summaryDrafted: !!executiveSummary?.draft,
    ofisAccepted: inReport,
    sectionsDrafted: drafted,
  })
  const done = draftedParts ?? counted.done
  const progress = { ...counted, done, percent: Math.round((done / counted.total) * 100) }
  const flagged = sections.filter((s) => s.review.state === 'needs_review').length
  // Reviewed as MarshBot counts it (server/src/services/assistant/progress.ts): the summary
  // when drafted and up to date, Section 3 with an accepted OFI, and 4-12 drafted with nothing open.
  const reviewed =
    Number(!!executiveSummary?.draft && !executiveSummary.staleSections.length) +
    Number(inReport > 0) +
    sections.filter(
      (s) =>
        s.completion.state !== 'not_started' &&
        s.findings.pending +
          s.review.unsupportedStatements +
          s.review.withdrawnSources +
          s.review.changesSinceDraft +
          (s.replacement ? 1 : 0) ===
          0,
    ).length
  // One row: the design system's section row as a button.
  const row = (
    id: string,
    title: string,
    note: React.ReactNode,
    mark?: React.ReactNode,
    flag?: 'warn',
  ) => (
    <li key={id}>
      <SectionRow
        number={id}
        name={title}
        note={note}
        mark={mark}
        flag={flag}
        current={selected === id}
        walk={ROW_WALK[id]}
        onSelect={() => onSelect(id)}
      />
    </li>
  )
  const summaryBadge = !executiveSummary ? null : executiveSummary.staleSections.length ? (
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
  )
  return (
    <nav ref={nav} aria-label="Report sections" className="om-scroll rv-rail" style={style}>
      <div className="rv-rail-top">
        <div className="rv-rail-head">
          <p className="rv-label">Report</p>
          {/* What the review states mean, behind the (?) rather than under the list. */}
          <HelpTip label="What the section states mean">
            <p>
              A section <strong>needs review</strong> when a statement is unsupported, a source it
              cites was withdrawn, or observations changed after it was drafted.
            </p>
            <p>
              It's <strong>reviewed</strong> once every finding is accepted, edited or rejected, and{' '}
              <strong>edited by you</strong> once you change or write it in the document.
            </p>
          </HelpTip>
        </div>
        <ProgressBar
          value={progress.percent}
          label={`${progress.done} of ${plural(progress.total, 'section')} drafted`}
          tone="primary"
        />
        {(reviewed > 0 || flagged > 0) && (
          <p className="rv-rail-stats">
            {reviewed > 0 && (
              <span>
                {reviewed} of {progress.total} reviewed
              </span>
            )}
            {flagged > 0 && (
              <span className="is-flagged">
                {plural(flagged, 'section')} need{flagged === 1 ? 's' : ''} review
              </span>
            )}
          </p>
        )}
        {summary && <ReviewSummary summary={summary} />}
      </div>
      <ul className="rv-rail-list">
        {!hideOpening && row('1', 'Purpose and Scope', <span>From assessment details</span>)}
        {!hideOpening && row('2', 'Executive Summary', summaryBadge)}
        {row(
          '3',
          'Opportunities for Improvement',
          inReport > 0 ? (
            <Badge tone="low" icon="check">
              {inReport} in the report
            </Badge>
          ) : (
            <Badge tone="neutral" icon="circle-dashed">
              None in the report
            </Badge>
          ),
        )}
        {sections.map((s) => {
          const badge = REVIEW_BADGE[s.review.state]
          const working = regenerating.has(s.id)
          return row(
            s.id,
            s.title,
            <>
              <Badge tone={badge.tone} icon={badge.icon}>
                {badge.label}
              </Badge>
              {/* Changed in the document while still flagged (RV-08 AC12). */}
              {s.review.editedInDocument && s.review.state !== 'edited' && (
                <Badge tone={REVIEW_BADGE.edited.tone} icon={REVIEW_BADGE.edited.icon}>
                  {REVIEW_BADGE.edited.label}
                </Badge>
              )}
              {s.replacement && (
                <Badge tone="ai" icon={IconRegistry.action.regenerate}>
                  Replacement ready
                </Badge>
              )}
              {/* How much of it is written (RV-01 AC5), on the badge's line. */}
              <span className="rv-rail-completion">{completionLabel(s.completion)}</span>
              {/* From the server's drafting state (GN-13); a run's first draft is not a redraft. */}
              {working && (
                <span className="rv-rail-completion rv-rail-regenerating">
                  {redrafting.has(s.id) ? (s.draft ? 'Redrafting' : 'Drafting') : 'Regenerating'}
                </span>
              )}
            </>,
            working ? <RowMark kind="working" label="Working" /> : undefined,
            // A section that needs another look is tinted amber, as flagged rows are on Generation.
            s.review.state === 'needs_review' ? 'warn' : undefined,
          )
        })}
        {!hideOpening && row('A', 'Site Photos', <span>Appendix A</span>)}
      </ul>
    </nav>
  )
}
