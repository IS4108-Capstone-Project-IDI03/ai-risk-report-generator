import { useEffect } from 'react'
import {
  AIDraftBlock,
  Badge,
  Button,
  Callout,
  EmptyState,
  IconRegistry,
} from '../../../design-system'
import type { ReviewDraft, ReviewSection } from '../api'
import { formatDayTime, formatDayYearTime } from '../format'
import {
  claimsOf,
  describeChanges,
  FINDING_BADGE,
  maturityEntries,
  plural,
  statementId,
  type Claim,
  type ReviewFocus,
} from '../reviewDisplay'
import { CitationMark } from './CitationMark'
import { MaturityTable } from './MaturityTable'

type Citing = {
  sectionId: string
  numbers: Map<string, number>
  focus: ReviewFocus
  describe: (citation: string) => string
  onCite: (citation: string | null, statement: string | null) => void
}

// The engineer's decisions on each finding (RV-02). Left out where they may
// not decide: a knowledge admin, another engineer, an archived assessment, or
// a replacement draft not yet accepted.
export type FindingActions = {
  // The finding whose decision is being saved, if any; the others wait.
  busy: string | null
  onAccept: (claim: Claim) => void
  onEdit: (claim: Claim) => void
  onReject: (claim: Claim) => void
}

// One finding: its text and citations, its review decision and who made it,
// and the actions on it.
function Finding({
  claim,
  actions,
  sectionId,
  numbers,
  focus,
  describe,
  onCite,
  shown,
}: Citing & {
  claim: Claim
  actions?: FindingActions
  // The text to show, when not the claim's whole text: a Section 6 row's comment.
  shown?: string
}) {
  const { review } = claim
  // In the engineer's words rather than the draft's: edited, and perhaps
  // accepted since.
  const reworded = claim.generatedText !== claim.text
  const badge =
    review.state === 'accepted' && reworded
      ? { ...FINDING_BADGE.accepted, label: 'Accepted with edits' }
      : FINDING_BADGE[review.state]
  const busy = actions?.busy != null
  return (
    <div
      role="group"
      aria-label={`Finding ${claim.number}`}
      className={'rv-finding' + (review.state === 'pending' ? ' is-pending' : '')}
    >
      <p
        id={statementId(sectionId, claim.key)}
        className={
          'rv-statement' +
          (focus.statement === claim.key ? ' is-active' : '') +
          (claim.supported ? '' : ' is-unsupported')
        }
      >
        <span className="rv-statement-text">{shown ?? claim.text}</span>
        {claim.citations.map((c, n) => (
          <CitationMark
            key={n}
            number={numbers.get(c)!}
            label={describe(c)}
            current={focus.citation === c}
            onSelect={() => onCite(c, claim.key)}
          />
        ))}
        {!claim.supported && (
          <span className="rv-flag">
            <Badge tone="moderate" icon="triangle-alert">
              Unsupported
            </Badge>
          </span>
        )}
      </p>
      <div className="rv-finding-bar">
        {/* Only a decision is labelled: a pending finding is marked by its violet rule. */}
        {review.state !== 'pending' && (
          <Badge tone={badge.tone} icon={badge.icon}>
            {badge.label}
          </Badge>
        )}
        {review.by && review.at && (
          <span className="rv-finding-by">
            {review.by.name} · {formatDayYearTime(new Date(review.at))}
          </span>
        )}
        <span className="rv-finding-gap" />
        {actions && (
          <>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={IconRegistry.action.reject}
              aria-label={`Reject finding ${claim.number}`}
              disabled={busy}
              onClick={() => actions.onReject(claim)}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={IconRegistry.action.edit}
              aria-label={`Edit finding ${claim.number}`}
              disabled={busy}
              onClick={() => actions.onEdit(claim)}
            >
              Edit
            </Button>
            {(review.state === 'pending' || review.state === 'edited') && (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={IconRegistry.action.accept}
                aria-label={`Accept finding ${claim.number}`}
                disabled={busy}
                loading={actions.busy === claim.key}
                onClick={() => actions.onAccept(claim)}
              >
                Accept
              </Button>
            )}
          </>
        )}
      </div>
      {reworded && (
        <details className="rv-finding-original">
          <summary>Drafted text</summary>
          <p>{claim.generatedText}</p>
        </details>
      )}
    </div>
  )
}

function DraftSubsection({
  sub,
  claims,
  actions,
  ...citing
}: Citing & {
  sub: ReviewDraft['subsections'][number]
  claims: Claim[]
  actions?: FindingActions
}) {
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
  if (!claims.length) {
    return (
      <div className="rv-subsection-note">
        <strong>{sub.heading}</strong>
        <p className="rv-muted">
          Every finding in this subsection was rejected, so it is left out of the report. The review
          history keeps them.
        </p>
      </div>
    )
  }
  // Section 6's programs are Marsh's two tables (GN-11); each row is still a finding.
  if (citing.sectionId === '6' && sub.heading === 'Management Programs') {
    const { entries, unplaced } = maturityEntries(
      claims,
      (claim) => claim.text,
      (claim, comment) => <Finding claim={claim} actions={actions} shown={comment} {...citing} />,
    )
    return <MaturityTable entries={entries} unplaced={unplaced} />
  }
  const cited = [...new Set(claims.flatMap((c) => c.citations))]
  const pending = claims.filter((c) => c.review.state === 'pending')
  const unsupported = pending.some((c) => !c.supported)
  return (
    <AIDraftBlock
      heading={sub.heading}
      // AI chrome while a finding waits for a decision; neutral once the
      // engineer has accepted or edited every one (the words are theirs).
      status={
        pending.length
          ? unsupported
            ? 'flagged'
            : 'draft'
          : claims.some((c) => c.review.state === 'edited')
            ? 'edited'
            : 'accepted'
      }
      // No status badge or confidence meter: the box marks AI text, each finding
      // its decision, and Unsupported its exception (Miya, 15 Oct).
      quiet
      evidenceCount={cited.length}
      // Opens the subsection's first source beside the draft.
      onShowEvidence={() => citing.onCite(cited[0] ?? null, null)}
    >
      {/* Marsh's lead-in to Section 4's positive points (GN-03): fixed, so not drafted. */}
      {citing.sectionId === '4' && sub.heading === 'Positive Points' && (
        <p className="rv-muted">The positive points from the visit are the following:</p>
      )}
      {claims.map((claim) => (
        <Finding key={claim.key} claim={claim} actions={actions} {...citing} />
      ))}
    </AIDraftBlock>
  )
}

// The draft editor of the review workspace (RV-01 AC1): the selected
// section's saved draft in the template's order. Each citation is a numbered
// button that opens its source in the panel beside the draft (AC7). Each
// finding shows its review decision and, for the assigned engineer, Accept,
// Edit and Reject (RV-02); rejected findings are left out. `header` holds the
// section's review controls; a replacement draft is shown read-only.
export function DraftEditor({
  section,
  position,
  onPrevious,
  onNext,
  onGenerate,
  actions,
  header,
  figures,
  ...citing
}: Omit<Citing, 'sectionId'> & {
  section: ReviewSection
  // e.g. "2 of 6"
  position: string
  onPrevious?: () => void
  onNext?: () => void
  onGenerate: () => void
  actions?: FindingActions
  header?: React.ReactNode
  // Sections 4 and 5 (GN-03): the engineer's figures, shown above the draft and
  // before there is one, since they must be entered first. As a function (Section
  // 5), it is given each subsection's findings by heading and lays them out itself,
  // inside Marsh's per-level tables, so they are not listed again below.
  figures?: React.ReactNode | ((drafted: Map<string, React.ReactNode>) => React.ReactNode)
}) {
  const { draft, review } = section

  // A claim picked in the panel scrolls its statement into view.
  useEffect(() => {
    if (citing.focus.statement)
      document
        .getElementById(statementId(section.id, citing.focus.statement))
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [section.id, citing.focus.statement])

  const claims = draft ? claimsOf(draft) : []
  const placesFindings = typeof figures === 'function'
  // Each subsection's findings, with their decisions, for figures that place them;
  // a subsection with none is left out, so it reads as not drafted.
  const drafted = new Map<string, React.ReactNode>(
    (draft?.subsections ?? []).flatMap((sub, i) => {
      const own = claims.filter((c) => c.key.startsWith(`${i}.`))
      return own.length
        ? [
            [
              sub.heading,
              own.map((claim) => (
                <Finding
                  key={claim.key}
                  claim={claim}
                  actions={actions}
                  sectionId={section.id}
                  {...citing}
                />
              )),
            ] as const,
          ]
        : []
    }),
  )
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
        {placesFindings ? figures(drafted) : figures}
        {!draft ? (
          <EmptyState
            icon="file-text"
            title="Not drafted yet"
            description="This section has no draft to review. Draft it on the Generation tab."
            action={
              <Button variant="secondary" iconLeft="sparkles" onClick={onGenerate}>
                Go to Generation
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
            {header}
            {review.changesSinceDraft > 0 && (
              <Callout tone="warning" title="This draft is out of date">
                {describeChanges(review.changeCounts)} since it was drafted. Redraft it on the
                Generation tab, or regenerate it here, to bring it up to date.
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
                Unsupported, even once accepted, until rejected.
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
            {!placesFindings &&
              draft.subsections.map((sub, i) => (
                <DraftSubsection
                  key={sub.heading}
                  sub={sub}
                  claims={claims.filter((c) => c.key.startsWith(`${i}.`))}
                  actions={actions}
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
