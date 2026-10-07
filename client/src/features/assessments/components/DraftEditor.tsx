import { useEffect } from 'react'
import { AIDraftBlock, Badge, Button, Callout, EmptyState } from '../../../design-system'
import type { ReviewSection, SectionDraft } from '../api'
import { formatDayTime } from '../format'
import { plural, statementId, type ReviewFocus } from '../reviewDisplay'
import { CitationMark } from './CitationMark'

type Citing = {
  sectionId: string
  numbers: Map<string, number>
  focus: ReviewFocus
  describe: (citation: string) => string
  onCite: (citation: string | null, statement: string | null) => void
}

function DraftSubsection({
  sub,
  index,
  sectionId,
  numbers,
  focus,
  describe,
  onCite,
}: Citing & { sub: SectionDraft['subsections'][number]; index: number }) {
  if (sub.kind === 'table' || !sub.statements.length) {
    return (
      <div className="rv-subsection-note">
        <strong>{sub.heading}</strong>
        <p className="rv-muted">
          {sub.kind === 'table'
            ? 'This table is completed from measured values, so it is not drafted.'
            : 'No evidence covers this subsection, so it was left empty.'}
        </p>
      </div>
    )
  }
  const cited = [...new Set(sub.statements.flatMap((s) => s.citations))]
  const unsupported = sub.statements.some((s) => !s.supported)
  return (
    <AIDraftBlock
      heading={sub.heading}
      status={unsupported ? 'flagged' : 'draft'}
      // Every citation resolves, but whether each source says what the
      // statement claims is not checked yet (GN-02), so this is never high.
      confidence={unsupported ? 'low' : 'medium'}
      evidenceCount={cited.length}
      // Opens the subsection's first source beside the draft.
      onShowEvidence={() => onCite(cited[0] ?? null, null)}
    >
      {sub.statements.map((s, j) => {
        const key = `${index}.${j}`
        return (
          <p
            key={key}
            id={statementId(sectionId, key)}
            className={
              'rv-statement' +
              (focus.statement === key ? ' is-active' : '') +
              (s.supported ? '' : ' is-unsupported')
            }
          >
            <span className="rv-statement-text">{s.text}</span>
            {s.citations.map((c, n) => (
              <CitationMark
                key={n}
                number={numbers.get(c)!}
                label={describe(c)}
                current={focus.citation === c}
                onSelect={() => onCite(c, key)}
              />
            ))}
            {!s.supported && (
              <span className="rv-flag">
                <Badge tone="moderate" icon="triangle-alert">
                  Unsupported
                </Badge>
              </span>
            )}
          </p>
        )
      })}
    </AIDraftBlock>
  )
}

// The draft editor of the review workspace (RV-01 AC1): the selected
// section's newest draft in the template's order. Each citation is a numbered
// button that opens its source in the panel beside the draft (AC7). The draft
// is read-only here: accepting and editing findings come with RV-02.
export function DraftEditor({
  section,
  position,
  onPrevious,
  onNext,
  onGenerate,
  ...citing
}: Omit<Citing, 'sectionId'> & {
  section: ReviewSection
  // e.g. "2 of 6"
  position: string
  onPrevious?: () => void
  onNext?: () => void
  onGenerate: () => void
}) {
  const { draft, review } = section

  // A claim picked in the panel scrolls its statement into view.
  useEffect(() => {
    if (citing.focus.statement)
      document
        .getElementById(statementId(section.id, citing.focus.statement))
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [section.id, citing.focus.statement])

  return (
    <section aria-label="Draft editor" className="om-scroll rv-editor">
      <div className="rv-editor-inner">
        <div className="rv-editor-bar">
          <p className="rv-label">Draft editor · {position}</p>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="chevron-left"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconRight="chevron-right"
            disabled={!onNext}
            onClick={onNext}
          >
            Next
          </Button>
        </div>
        <h2>
          {section.id}. {section.title}
        </h2>
        {!draft ? (
          <EmptyState
            icon="file-text"
            title="Not drafted yet"
            description="This section has no draft to review. Draft it on the Report generation tab."
            action={
              <Button variant="secondary" iconLeft="sparkles" onClick={onGenerate}>
                Go to Report generation
              </Button>
            }
          />
        ) : (
          <>
            <p className="rv-provenance">
              Drafted {formatDayTime(new Date(draft.provenance.generated_at))} ·{' '}
              {draft.provenance.model} ({draft.provenance.effort} effort) · prompt{' '}
              {draft.provenance.prompt_version} · template {draft.provenance.template_version}
            </p>
            {review.changesSinceDraft > 0 && (
              <Callout tone="warning" title="This draft is out of date">
                {plural(review.changesSinceDraft, 'observation')}{' '}
                {review.changesSinceDraft === 1 ? 'was' : 'were'} added, changed or removed after it
                was drafted. Redraft it on the Report generation tab to bring it up to date.
              </Callout>
            )}
            {review.withdrawnSources > 0 && (
              <Callout
                tone="warning"
                title={
                  review.withdrawnSources === 1
                    ? 'A source this draft cites has been withdrawn'
                    : `${review.withdrawnSources} sources this draft cites have been withdrawn`
                }
              >
                Search no longer uses {review.withdrawnSources === 1 ? 'it' : 'them'}. Open each
                citation marked Withdrawn and check whether its statement still stands.
              </Callout>
            )}
            {review.unsupportedStatements > 0 && (
              <Callout tone="warning" title="Some statements need review">
                {plural(review.unsupportedStatements, 'statement')}{' '}
                {review.unsupportedStatements === 1 ? 'rests' : 'rest'} on no evidence from this
                assessment or its standards: no citation, a source that could not be found, or only
                a past report. {review.unsupportedStatements === 1 ? 'It is' : 'They are'} marked
                Unsupported.
              </Callout>
            )}
            {draft.questions.length > 0 && (
              <Callout tone="info" title="Questions for the engineer">
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {draft.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </Callout>
            )}
            {draft.subsections.map((sub, i) => (
              <DraftSubsection
                key={sub.heading}
                sub={sub}
                index={i}
                sectionId={section.id}
                {...citing}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}
