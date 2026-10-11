import { useState } from 'react'
import { Button, Callout, EmptyState } from '../../../design-system'
import { AppendixPhotos } from '../components/AppendixPhotos'
import { DraftEditor } from '../components/DraftEditor'
import { ExecutiveSummary } from '../components/ExecutiveSummary'
import { PurposeScope } from '../components/PurposeScope'
import { ReportPart } from '../components/ReportPart'
import { OfiBlock } from '../components/OfiSuggestions'
import { ReviewSectionRail } from '../components/ReviewSectionRail'
import { SourcePanel } from '../components/SourcePanel'
import { citationNumbers, describeCitation, type ReviewFocus } from '../reviewDisplay'
import { formatDayTime } from '../format'
import { useObservations } from '../useObservations'
import { useOfis } from '../useOfis'
import { useReview } from '../useReview'
import { useSummary } from '../useSummary'
import '../review.css'

const NOTHING: ReviewFocus = { citation: null, statement: null }
// The rail's rows that are not one of sections 7-12.
const OPENING = new Set(['1', '2', '3', 'A'])

// The Review tab for a saved assessment (RV-01): sections 7-12 down the side
// with their completion and review states, the selected section's draft in
// the middle, and its sources, original observations and claims beside it.
// Section 3 (GN-05) shows the OFIs accepted into the report, in Marsh's tables.
// Sections 1 and 2 lead the rail and Appendix A ends it (GN-07).
// Read-only until the review stories add decisions on findings (RV-02).
export function ReviewWorkspace({
  reference,
  canEdit,
  wrapStyle,
  railStyle,
  panelStyle,
  onGenerate,
}: {
  reference: string
  // Whether this user may change the appendix: the assigned engineer, while
  // the assessment is open. The gateway checks it too.
  canEdit: boolean
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
  panelStyle: React.CSSProperties
  onGenerate: () => void
}) {
  const { sections, loadError } = useReview(reference)
  const { ofis } = useOfis(reference)
  const { summary, loadError: summaryError } = useSummary(reference)
  // For each OFI's sources, as on Generation.
  const { observations } = useObservations(reference, true)
  // Only a list from the gateway counts; anything else reads as no OFIs yet.
  const accepted = Array.isArray(ofis?.accepted) ? ofis.accepted : []
  const waiting = Array.isArray(ofis?.suggestions) ? ofis.suggestions.length : 0
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<ReviewFocus>(NOTHING)

  if (loadError)
    return (
      <div style={{ padding: '24px 28px' }}>
        <Callout tone="danger" title="The review workspace could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  if (!sections)
    return <p style={{ padding: '24px 28px', margin: 0 }}>Loading the report sections…</p>

  const drafted = sections.filter((s) => s.draft)
  // The first drafted section opens until another is chosen.
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === (selected ?? drafted[0]?.id)),
  )
  // undefined only when the template lists no sections (S4 not answering).
  const section = sections[index] as (typeof sections)[number] | undefined
  const numbers = section?.draft ? citationNumbers(section.draft) : new Map<string, number>()
  const describe = (citation: string) => describeCitation(section!, citation)
  const select = (id: string) => {
    setSelected(id)
    setFocus(NOTHING)
  }
  const cite = (citation: string | null, statement: string | null) =>
    setFocus({ citation, statement })
  const previous = sections[index - 1]
  const next = sections[index + 1]
  const rail = (
    <ReviewSectionRail
      sections={sections}
      selected={selected && OPENING.has(selected) ? selected : (section?.id ?? '')}
      onSelect={select}
      inReport={accepted.length}
      summary={summary?.executiveSummary ?? null}
      style={railStyle}
    />
  )
  const last = sections[sections.length - 1]

  // Sections 1 and 2, and Appendix A: one view each, with a side panel that
  // says where its content comes from.
  const part = (
    title: string,
    body: React.ReactNode,
    note: string,
    nav: { onPrevious?: () => void; onNext?: () => void },
  ) => (
    <div style={wrapStyle}>
      {rail}
      <ReportPart title={title} {...nav}>
        {body}
      </ReportPart>
      <aside aria-label={`${title} notes`} className="om-scroll" style={panelStyle}>
        <div className="rv-panel-section">
          <div className="rv-viewer is-empty">
            <p className="rv-muted">{note}</p>
          </div>
        </div>
      </aside>
    </div>
  )
  if (selected === '1')
    return part(
      '1. Purpose and Scope',
      <PurposeScope text={summary?.purposeAndScope ?? null} error={summaryError} />,
      'Section 1 is filled in from the assessment and site details, with no AI drafting. It always matches them.',
      { onNext: () => select('2') },
    )
  if (selected === '2')
    return part(
      '2. Executive Summary',
      <ExecutiveSummary
        summary={summary?.executiveSummary ?? null}
        error={summaryError}
        onGenerate={onGenerate}
      />,
      'The Executive Summary is drafted only from Sections 3 to 12 as they stand. Each statement names the sections it rests on.',
      { onPrevious: () => select('1'), onNext: () => select('3') },
    )
  if (selected === 'A')
    return part(
      'Appendix A. Site Photos',
      <AppendixPhotos reference={reference} canEdit={canEdit} />,
      'The export (EX-01) shows only these photos, in this order, with their captions.',
      { onPrevious: last && (() => select(last.id)) },
    )

  // Nothing drafted yet: the rail stays, so Sections 1 and 2 and Appendix A
  // (which need no draft of 7-12) can still be opened (GN-07 AC1, AC5).
  if (!section || (!drafted.length && selected !== '3'))
    return (
      <div style={wrapStyle}>
        {rail}
        <section className="om-scroll rv-editor">
          <EmptyState
            icon="file-text"
            title="No sections drafted yet"
            description="Drafted sections appear here for review. Draft them on the Generation tab."
            action={
              <Button variant="primary" iconLeft="sparkles" onClick={onGenerate}>
                Go to Generation
              </Button>
            }
          />
        </section>
      </div>
    )

  // Section 3: the OFIs in the report, laid out like a section's draft: the editor
  // bar, the provenance of their drafting, then each OFI in an AI draft box.
  // Accepting more happens on Generation.
  if (selected === '3') {
    const drafted = accepted[0]?.provenance
    return (
      <div style={wrapStyle}>
        {rail}
        <section aria-label="Draft editor" className="om-scroll rv-editor">
          <div className="rv-editor-inner">
            <div className="rv-editor-bar">
              <p className="rv-label">Draft editor · 1 of {sections.length + 1}</p>
              <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={() => select('2')}>
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconRight="chevron-right"
                disabled={!sections.length}
                onClick={() => select(sections[0].id)}
              >
                Next
              </Button>
            </div>
            <h2>3. Opportunities for Improvement</h2>
            {!drafted ? (
              <EmptyState
                icon="file-text"
                title="No OFIs in the report yet"
                description="Draft and accept Opportunities for Improvement on the Generation tab."
                action={
                  <Button variant="secondary" iconLeft="sparkles" onClick={onGenerate}>
                    Go to Generation
                  </Button>
                }
              />
            ) : (
              <>
                <p className="rv-provenance">
                  Drafted {formatDayTime(new Date(drafted.generated_at))} · {drafted.model} (
                  {drafted.effort} effort) · prompt {drafted.prompt_version} · config{' '}
                  {drafted.config_version}
                </p>
                {accepted.map((o) => (
                  <OfiBlock
                    key={o.id}
                    ofi={o}
                    number={o.number}
                    observations={observations ?? []}
                  />
                ))}
              </>
            )}
          </div>
        </section>
        <aside aria-label="Section 3 suggestions" className="om-scroll" style={panelStyle}>
          <div className="rv-panel-section">
            <div className="rv-viewer is-empty">
              <p className="rv-muted">
                {waiting
                  ? `${waiting} suggested OFI${waiting === 1 ? ' is' : 's are'} waiting to be accepted.`
                  : 'No suggested OFIs are waiting.'}{' '}
                Each OFI's sources open below it. Suggestions are drafted and accepted on Report
                generation.
              </p>
              <div style={{ marginTop: '12px' }}>
                <Button variant="secondary" size="sm" iconLeft="sparkles" onClick={onGenerate}>
                  Go to Generation
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    )
  }

  return (
    <div style={wrapStyle}>
      {rail}
      <DraftEditor
        section={section}
        // Section 3 is the report's first section here, so 7-12 count from 2.
        position={`${index + 2} of ${sections.length + 1}`}
        onPrevious={() => select(previous ? previous.id : '3')}
        onNext={next && (() => select(next.id))}
        onGenerate={onGenerate}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
      />
      <SourcePanel
        savedObservations={observations}
        section={section}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
        onShowClaim={(claim) => setFocus((f) => ({ ...f, statement: claim }))}
        style={panelStyle}
      />
    </div>
  )
}
