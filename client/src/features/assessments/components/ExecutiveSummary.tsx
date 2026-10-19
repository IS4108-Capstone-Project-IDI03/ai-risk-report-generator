import { AIDraftBlock, Badge, Button, Callout } from '../../../design-system'
import type { SectionVersion, Summary } from '../api'
import { asDrafted, hasWritten, signature, summaryContent } from '../documentContent'
import { formatDayTime } from '../format'
import { WrittenBlocks } from './WrittenBlocks'

// A Section 2 citation, `S:7`, is Section 7, as rag-service's draft_summary labels it.
const sectionTag = (c: string) => (
  <>
    {' '}
    <Badge tone="neutral">{`Section ${c.replace(/^S:/, '')}`}</Badge>
  </>
)

// Section 2 Executive Summary (GN-07): the drafted narrative, each statement
// tagged with the sections it rests on (AC2); the sections still to complete
// before it can be drafted (AC3); and a warning once a section it summarised
// has changed (AC4). The template's other two parts are left for the engineer.
export function ExecutiveSummary({
  summary,
  error,
  onGenerate,
  fullWidth = false,
  showCitations = true,
  document = null,
}: {
  summary: Summary['executiveSummary'] | null
  error: string | null
  onGenerate: () => void
  // Fill the width rather than hold prose to 68ch: on Generation, not in Review.
  fullWidth?: boolean
  // The "Section N" tags; Generation leaves them to Review, as it does all citations.
  showCitations?: boolean
  // Its newest version from the document editor (RV-08), shown in Review.
  document?: SectionVersion | null
}) {
  if (error)
    return (
      <Callout tone="danger" title="Section 2 could not be loaded">
        {error}
      </Callout>
    )
  if (!summary) return <p className="rv-muted">Loading…</p>
  const { draft, missing, staleSections } = summary
  const edited = document?.current ? summaryContent(draft, document) : null
  const saved = edited && document && (
    <p className="rv-provenance">
      Last saved in the document {formatDayTime(new Date(document.savedAt))} by{' '}
      {document.savedBy.name}
    </p>
  )
  if (!draft && edited && hasWritten(edited.intro))
    return (
      <>
        {saved}
        <Callout tone="info" title="Written by you">
          The Executive Summary was not drafted: its text is yours, from the document editor.
        </Callout>
        <div className="rv-written-section">
          <WrittenBlocks blocks={edited.intro} cite={showCitations ? sectionTag : undefined} />
        </div>
      </>
    )
  if (!draft)
    return missing.length ? (
      <Callout tone="info" title="Complete these sections first">
        <p style={{ margin: '0 0 8px' }}>
          The Executive Summary summarises the report&apos;s other sections, so each must be drafted
          first.
        </p>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          {missing.map((s) => (
            <li key={s.id}>
              {s.id}. {s.title}
            </li>
          ))}
        </ul>
      </Callout>
    ) : (
      <Callout tone="info" title="Not drafted yet">
        <p style={{ margin: '0 0 12px' }}>
          Every section is ready. Draft it on the Generation tab.
        </p>
        <Button variant="secondary" size="sm" iconLeft="sparkles" onClick={onGenerate}>
          Go to Generation
        </Button>
      </Callout>
    )

  const [narrative, ...others] = draft.subsections
  const unsupported = narrative.statements.some((s) => !s.supported)
  // A statement still as drafted keeps the AI chrome; once the engineer
  // changed or added to the narrative in the document, it is theirs.
  const statementAt = (key: string | null | undefined) => {
    if (!key) return null
    const [i, j] = key.split('.').map(Number)
    return draft.subsections[i]?.statements[j] ?? null
  }
  const narrativeBlocks = edited?.subsections[0]?.blocks
  const asDraftedNow =
    !narrativeBlocks ||
    (!hasWritten(narrativeBlocks) &&
      narrativeBlocks.every(
        (b) =>
          b.type === 'paragraph' &&
          signature(b.content) ===
            signature(asDrafted(statementAt(b.finding) ?? { text: '', citations: [] })),
      ) &&
      narrativeBlocks.length === narrative.statements.length)
  return (
    <>
      <p className="rv-provenance">
        Drafted {formatDayTime(new Date(draft.provenance.generated_at))} · {draft.provenance.model}{' '}
        ({draft.provenance.effort} effort) · prompt {draft.provenance.prompt_version}
      </p>
      {saved}
      {staleSections.length > 0 && (
        <Callout tone="warning" title="This summary is out of date">
          {staleSections.map((s) => `${s.id}. ${s.title}`).join(', ')} changed since it was drafted.
          Redraft it on the Generation tab.
        </Callout>
      )}
      <AIDraftBlock
        heading={narrative.heading}
        status={asDraftedNow ? (unsupported ? 'flagged' : 'draft') : 'edited'}
        // No status badge or confidence meter: it is all AI drafted, and a weak
        // statement carries its own Unsupported flag (Miya, 15 Oct).
        quiet
        evidenceCount={new Set(narrative.statements.flatMap((s) => s.citations)).size}
        fullWidth={fullWidth}
      >
        {narrativeBlocks && !asDraftedNow ? (
          <WrittenBlocks
            blocks={narrativeBlocks}
            cite={showCitations ? sectionTag : undefined}
            flagged={(key) => statementAt(key)?.supported === false}
          />
        ) : (
          narrative.statements.map((s, i) => (
            <p key={i} className={'rv-statement' + (s.supported ? '' : ' is-unsupported')}>
              <span className="rv-statement-text">{s.text}</span>{' '}
              {/* `S:7` is Section 7, as rag-service's draft_summary labels it. */}
              {showCitations && (
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px' }}>
                  {s.citations.map((c) => (
                    <Badge key={c} tone="neutral">
                      {`Section ${c.replace(/^S:/, '')}`}
                    </Badge>
                  ))}
                </span>
              )}
              {!s.supported && (
                <span className="rv-flag">
                  <Badge tone="moderate" icon="triangle-alert">
                    Unsupported
                  </Badge>
                </span>
              )}
            </p>
          ))
        )}
      </AIDraftBlock>
      {others.map((sub, i) => {
        const written = edited?.subsections[i + 1]?.blocks ?? []
        return hasWritten(written) ? (
          <div key={sub.heading} className="rv-written-section">
            <strong>{sub.heading}</strong>
            <WrittenBlocks blocks={written} cite={showCitations ? sectionTag : undefined} />
          </div>
        ) : (
          <div key={sub.heading} className="rv-subsection-note">
            <strong>{sub.heading}</strong>
            <p className="rv-muted">
              Left for the engineer to write: the evidence says nothing of earlier surveys or
              planned work.
            </p>
          </div>
        )
      })}
    </>
  )
}
