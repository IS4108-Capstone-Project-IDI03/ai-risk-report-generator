import { useState } from 'react'
import { Button, Callout, EmptyState } from '../../../design-system'
import { DraftEditor } from '../components/DraftEditor'
import { ReviewSectionRail } from '../components/ReviewSectionRail'
import { SourcePanel } from '../components/SourcePanel'
import { citationNumbers, describeCitation, type ReviewFocus } from '../reviewDisplay'
import { useReview } from '../useReview'
import '../review.css'

const NOTHING: ReviewFocus = { citation: null, statement: null }

// The Review tab for a saved assessment (RV-01): sections 7-12 down the side
// with their completion and review states, the selected section's draft in
// the middle, and its sources, original observations and claims beside it.
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
        description="Drafted sections appear here for review. Draft them on the Report generation tab."
        action={
          <Button variant="primary" iconLeft="sparkles" onClick={onGenerate}>
            Go to Report generation
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

  return (
    <div style={wrapStyle}>
      <ReviewSectionRail
        sections={sections}
        selected={section.id}
        onSelect={select}
        style={railStyle}
      />
      <DraftEditor
        section={section}
        position={`${index + 1} of ${sections.length}`}
        onPrevious={previous && (() => select(previous.id))}
        onNext={next && (() => select(next.id))}
        onGenerate={onGenerate}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
      />
      <SourcePanel
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
