import { useState } from 'react'
import { Button, Callout, EmptyState } from '../../../design-system'
import { DraftEditor } from '../components/DraftEditor'
import { OfiBlock } from '../components/OfiSuggestions'
import { ReviewSectionRail } from '../components/ReviewSectionRail'
import { SourcePanel } from '../components/SourcePanel'
import { citationNumbers, describeCitation, type ReviewFocus } from '../reviewDisplay'
import { formatDayTime } from '../format'
import { useObservations } from '../useObservations'
import { useOfis } from '../useOfis'
import { useReview } from '../useReview'
import '../review.css'

const NOTHING: ReviewFocus = { citation: null, statement: null }

// The Review tab for a saved assessment (RV-01): sections 7-12 down the side
// with their completion and review states, the selected section's draft in
// the middle, and its sources, original observations and claims beside it.
// Section 3 (GN-05) shows the OFIs accepted into the report, in Marsh's tables.
// Read-only until the review stories add decisions on findings (RV-02).
export function ReviewWorkspace({
  reference,
  wrapStyle,
  railStyle,
  panelStyle,
  onGenerate,
}: {
  reference: string
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
  panelStyle: React.CSSProperties
  onGenerate: () => void
}) {
  const { sections, loadError } = useReview(reference)
  const { ofis } = useOfis(reference)
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
  if (!drafted.length)
    return (
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
    )

  // The first drafted section opens until another is chosen.
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === (selected ?? drafted[0].id)),
  )
  const section = sections[index]
  const numbers = section.draft ? citationNumbers(section.draft) : new Map<string, number>()
  const describe = (citation: string) => describeCitation(section, citation)
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
      selected={selected === '3' ? '3' : section.id}
      onSelect={select}
      inReport={accepted.length}
      style={railStyle}
    />
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
              <Button variant="ghost" size="sm" iconLeft="chevron-left" disabled>
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconRight="chevron-right"
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
