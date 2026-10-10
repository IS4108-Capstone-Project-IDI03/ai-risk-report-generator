import { Fragment } from 'react'
import type * as React from 'react'
import { Badge, Button } from '../../../design-system'
import type { ReportSection, ReviewSection } from '../api'
import { StatBox, type BoxContent } from '../components/StatBox'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useReview } from '../useReview'
import { useSections } from '../useSections'

// What the drafting and review boxes, and the sections list, are drawn from:
// null when there is nothing to load (the assessment is not on the server).
type Report = {
  sections: ReportSection[] | null
  sectionsError: string | null
  review: ReviewSection[] | null
  reviewError: string | null
} | null

// The assessment at a glance: four boxes that follow the report from capture to
// its due date, its record, and where each report section stands.
export function Overview({ v }: { v: AssessmentWorkflow }) {
  return v.liveReference ? (
    <LiveOverview v={v} reference={v.liveReference} />
  ) : (
    <OverviewLayout v={v} report={null} />
  )
}

function LiveOverview({ v, reference }: { v: AssessmentWorkflow; reference: string }) {
  const { sections, loadError: sectionsError } = useSections(reference)
  const { sections: review, loadError: reviewError } = useReview(reference)
  return <OverviewLayout v={v} report={{ sections, sectionsError, review, reviewError }} />
}

const card: React.CSSProperties = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-sm)',
}
const cardHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '14px 20px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  fontSize: '19px',
  lineHeight: '28px',
  fontWeight: '600',
  color: 'var(--text-primary)',
}
const UNAVAILABLE: BoxContent = {
  value: '—',
  unit: 'unavailable',
  note: 'The drafting service can’t be reached',
  tone: 'warning',
}
const LOADING: BoxContent = { value: '…', note: 'Loading' }

// A button that looks like the row it wraps, keeping the global focus ring.
const plainButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
const unit = (n: number, word: string) => word + (n === 1 ? '' : 's')

// Sections drafted, and how many drafts newer observations have made stale.
function draftingBox(report: Report): BoxContent {
  if (!report)
    return { value: '—', unit: 'not available', note: 'Needs the assessment on the server' }
  if (report.sectionsError) return UNAVAILABLE
  if (!report.sections) return LOADING
  const all = report.sections
  const drafted = all.filter((s) => s.latestDraft)
  const stale = drafted.filter((s) => s.changesSinceDraft > 0).length
  const ready = all.filter(
    (s) => !s.latestDraft && s.usableObservations >= s.minObservations,
  ).length
  const figure = { value: drafted.length + '/' + all.length, unit: 'sections drafted' }
  if (stale) return { ...figure, note: stale + ' out of date', tone: 'warning' }
  if (drafted.length && drafted.length === all.length)
    return { ...figure, note: 'All drafted', tone: 'ok' }
  return {
    ...figure,
    note: ready
      ? plural(ready, 'section') + ' ready to draft'
      : drafted.length
        ? undefined
        : 'No section has enough evidence yet',
  }
}

// Drafts needing a closer look: statements without support, withdrawn sources,
// or observations changed since drafting. There is no sign-off yet, so a draft
// with none of those is an AI draft still to be read.
function reviewBox(report: Report): BoxContent {
  if (!report)
    return { value: '—', unit: 'not available', note: 'Needs the assessment on the server' }
  if (report.reviewError) return UNAVAILABLE
  if (!report.review) return LOADING
  const drafted = report.review.filter((s) => s.draft)
  if (!drafted.length)
    return { value: '—', unit: 'no drafts yet', note: 'Draft a section to review it' }
  const flagged = drafted.filter((s) => s.review.state === 'needs_review')
  if (!flagged.length)
    return {
      value: '0',
      unit: 'drafts flagged',
      note: plural(drafted.length, 'AI draft') + ' to read',
      tone: 'ok',
    }
  const sum = (key: 'unsupportedStatements' | 'withdrawnSources') =>
    flagged.reduce((n, s) => n + s.review[key], 0)
  const statements = sum('unsupportedStatements')
  const withdrawn = sum('withdrawnSources')
  const stale = flagged.filter((s) => s.review.changesSinceDraft > 0).length
  return {
    value: flagged.length + '/' + drafted.length,
    unit: unit(drafted.length, 'draft') + ' flagged',
    note:
      [
        statements && plural(statements, 'statement') + ' to check',
        withdrawn && plural(withdrawn, 'withdrawn source'),
        stale && stale + ' out of date',
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    tone: 'warning',
  }
}

// Where one report section stands, as a badge.
function sectionState(s: ReportSection) {
  if (s.latestDraft && s.changesSinceDraft > 0) return { tone: 'moderate', label: 'Out of date' }
  if (s.latestDraft) return { tone: 'ai', label: 'Drafted' }
  if (s.usableObservations >= s.minObservations) return { tone: 'info', label: 'Ready to draft' }
  return {
    tone: 'neutral',
    label: s.usableObservations + ' of ' + s.minObservations + ' observations',
  }
}

function OverviewLayout({ v, report }: { v: AssessmentWorkflow; report: Report }) {
  const capture = v.ovCapture
  const drafting = draftingBox(report)
  const review = reviewBox(report)
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        <div
          className="om-overview-wrap"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {/* Two to a row, or four where there is room, never three and one
              (workflow.css). */}
          <div className="om-overview-boxes">
            {/* Capturing is the header's Capture observations; this box
                opens the observations it counts. */}
            <StatBox
              icon="camera"
              label="Capture"
              content={{
                value: String(capture.count),
                unit: unit(capture.count, 'observation'),
                note: capture.note,
              }}
              onOpen={() => v.setTab('observations')}
              opens="Observations"
            />
            <StatBox
              icon="sparkles"
              label="Drafting"
              content={drafting}
              onOpen={report && v.canOpenGenerate ? v.goGenerate : undefined}
              opens="Generation"
            />
            <StatBox
              icon="user-round-search"
              label="Review"
              content={review}
              onOpen={report && v.canOpenReview ? v.goReview : undefined}
              opens="Review"
            />
            <StatBox icon="calendar-clock" label="Report due" content={v.ovDue} />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px),1fr))',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={cardHead}>
                {'Assessment record'}
                {/* Edits the details this card shows (RV-10 AC10). */}
                {v.canEditDetails && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft="pencil"
                    aria-label="Edit details"
                    onClick={v.goEditDetails}
                  >
                    {'Edit'}
                  </Button>
                )}
              </div>
              <div style={{ padding: '6px 20px 14px' }}>
                {v.ovFacts.map((ff, index) => (
                  <Fragment key={index}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '16px',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span
                        style={{
                          flex: '0 0 auto',
                          width: '150px',
                          fontSize: '14px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {ff.label}
                      </span>
                      <span
                        style={{
                          flex: '1',
                          minWidth: '0',
                          fontSize: '15px',
                          lineHeight: '22px',
                          color: 'var(--text-body)',
                          textWrap: 'pretty',
                        }}
                      >
                        {ff.value}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
            <ReportSections v={v} report={report} />
          </div>
        </div>
      </div>
    </>
  )
}

// Where each of sections 7-12 stands, so it is clear which are done and which
// still need observations from site. A row opens Generation.
function ReportSections({ v, report }: { v: AssessmentWorkflow; report: Report }) {
  const message = !report
    ? 'The report sections show here once this assessment is saved on the server.'
    : report.sectionsError
      ? 'The report sections can’t be loaded right now.'
      : !report.sections
        ? 'Loading the report sections…'
        : null
  const canOpen = !!report && v.canOpenGenerate
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={cardHead}>{'Report sections'}</div>
      {message ? (
        <p
          style={{ margin: 0, padding: '14px 20px', fontSize: '15px', color: 'var(--text-muted)' }}
        >
          {message}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
          {report!.sections!.map((s) => {
            const state = sectionState(s)
            const row = (
              <>
                <span
                  style={{
                    flex: '0 0 auto',
                    width: '24px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {s.id}
                </span>
                <span
                  style={{ flex: '1', minWidth: 0, fontSize: '15px', color: 'var(--text-body)' }}
                >
                  {s.title}
                </span>
                <Badge tone={state.tone}>{state.label}</Badge>
              </>
            )
            const rowStyle: React.CSSProperties = {
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 20px',
              borderBottom: '1px solid var(--border-subtle)',
            }
            return (
              <li key={s.id}>
                {canOpen ? (
                  <button
                    type="button"
                    className="om-overview-box"
                    onClick={v.goGenerate}
                    aria-label={`Section ${s.id}, ${s.title}: ${state.label}. Open Generation`}
                    style={{ ...plainButton, ...rowStyle }}
                  >
                    {row}
                  </button>
                ) : (
                  <div style={rowStyle}>{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
