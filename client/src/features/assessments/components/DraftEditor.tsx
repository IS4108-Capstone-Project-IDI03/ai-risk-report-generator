import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  AIDraftBlock,
  Badge,
  Button,
  Callout,
  EmptyState,
  IconRegistry,
  type Reason,
} from '../../../design-system'
import type {
  AiDraft,
  DocumentBlock,
  DocumentHeading,
  DocumentInline,
  DocumentParagraph,
  ReviewDraft,
  ReviewSection,
} from '../api'
import { markedText, unsupportedIn, unsupportedRanges } from '../aiText'
import { AskSelection } from '../ask/AskSelection'
import { askBlockAttrs } from '../ask/draftSelection'
import { contentText, type AskPassage, type PassageText } from '../ask/passage'
import type { CommentAnchor } from '../comments/api'
import { hasWritten, sectionContent, textBlocksIn } from '../documentContent'
import { formatDayTime, formatDayYearTime } from '../format'
import {
  claimsOf,
  describeChanges,
  FINDING_BADGE,
  maturityEntries,
  plural,
  statementId,
  subsectionId,
  type Claim,
  type ReviewFocus,
} from '../reviewDisplay'
import { Tip } from '../../help/Tip'
import { CitationMark } from './CitationMark'
import { RichWords, WrittenBlocks } from './WrittenBlocks'
import { MaturityTable } from './MaturityTable'

type Citing = {
  sectionId: string
  numbers: Map<string, number>
  focus: ReviewFocus
  describe: (citation: string) => string
  onCite: (citation: string | null, statement: string | null) => void
  // The section's text, for reading a selection as a passage to ask about (AS-02).
  askText?: PassageText
}

// Asking about text selected in the draft (AS-02): what Ask about this does,
// how the report heads the section, and the passage the Ask tab last went back
// to, to mark in the draft. With `onRewrite` (the assigned engineer, AS-04),
// Rewrite this beside it puts the passage in the Ask tab to be rewritten.
export type DraftAsk = {
  label: string
  onAsk: (passage: AskPassage) => void
  onRewrite?: (passage: AskPassage) => void
  shown: CommentAnchor | null
  // Why nothing can be asked (an archived assessment, AS-03 AC5).
  blocked?: Reason
}

// The engineer's decisions on AI-drafted text from the Ask tab (AS-04), for
// the assigned engineer only: Accept keeps it as theirs, Delete takes it out.
export type AiTextActions = {
  // The proposal whose text is being decided on, if any; the others wait.
  busy: string | null
  onAccept: (id: string) => void
  onDelete: (id: string) => void
}

// Where a block of the draft's text is in its section's text (AS-02).
const blockAttrs =
  (text: PassageText | undefined) => (block: DocumentParagraph | DocumentHeading) =>
    askBlockAttrs(text?.indexOf.get(block))
// Where a finding's block is, and where its shown words start in it: all of
// them, or only a Section 6 programme row's comment.
function findingAttrs(text: PassageText | undefined, key: string, shown: string | undefined) {
  const index = text?.blocks.findIndex((b) => b.finding === key) ?? -1
  if (!text || index < 0) return {}
  const block = text.blocks[index]
  const from =
    shown === undefined
      ? 0
      : text.text.slice(block.offset, block.offset + block.length).indexOf(shown)
  return askBlockAttrs(index, from)
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

// A citation marker in text from the document editor (RV-08), opening its
// source like any other.
const citeMark =
  (
    { numbers, focus, describe, onCite }: Omit<Citing, 'sectionId' | 'askText'>,
    claimKey: string | null,
    // The citation that carries the F-12 tag (Finding 1's first), if any.
    walkId?: string,
  ) =>
  (id: string) => (
    <CitationMark
      number={numbers.get(id) ?? 0}
      label={describe(id)}
      current={focus.citation === id}
      onSelect={() => onCite(id, claimKey)}
      walk={walkId !== undefined && id === walkId ? 'review.finding-1.cite' : undefined}
    />
  )

// A finding's sentence. When it is flagged Unsupported the help (?) sits beside it (F-13): in a
// row of its own, since the (?) holds a div, which may not be inside the sentence's <p>.
function StatementRow({ tip, children }: { tip: boolean; children: React.ReactNode }) {
  if (!tip) return <>{children}</>
  return (
    <div className="rv-statement-row">
      {children}
      <Tip id="review.unsupported" />
    </div>
  )
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
  askText,
  shown,
  content,
  heading = false,
}: Citing & {
  claim: Claim
  actions?: FindingActions
  // The text to show, when not the claim's whole text: a Section 6 row's comment.
  shown?: string
  // Its words as formatted in the document editor (RV-08), citations in place.
  content?: DocumentInline[]
  // Set as a sub-heading in the document editor (RV-08).
  heading?: boolean
}) {
  const { review } = claim
  // Citations deleted in the document editor (RV-08).
  const removed = claim.citationsRemoved ?? []
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
      // AS-06: counted as seen once it stays on screen (marshbot/useActivity).
      data-activity-key={claim.key}
      data-walk={claim.number === 1 ? 'review.finding-1.card' : undefined}
      className={'rv-finding' + (review.state === 'pending' ? ' is-pending' : '')}
    >
      <StatementRow tip={!claim.supported}>
        <p
          id={statementId(sectionId, claim.key)}
          className={
            'rv-statement' +
            (heading ? ' rv-statement-heading' : '') +
            (focus.statement === claim.key ? ' is-active' : '') +
            (claim.supported ? '' : ' is-unsupported')
          }
          data-walk={claim.number === 1 ? 'review.finding-1' : undefined}
          {...findingAttrs(askText, claim.key, shown)}
        >
          {content && shown === undefined ? (
            <RichWords
              content={content}
              cite={citeMark(
                { numbers, focus, describe, onCite },
                claim.key,
                claim.number === 1 ? claim.citations[0] : undefined,
              )}
            />
          ) : (
            <>
              <span className="rv-statement-text">{shown ?? claim.text}</span>
              {claim.citations.map((c, n) => (
                <CitationMark
                  key={n}
                  number={numbers.get(c)!}
                  label={describe(c)}
                  current={focus.citation === c}
                  onSelect={() => onCite(c, claim.key)}
                  walk={claim.number === 1 && n === 0 ? 'review.finding-1.cite' : undefined}
                />
              ))}
            </>
          )}
          {!claim.supported && (
            <span className="rv-flag">
              <Badge tone="moderate" icon="triangle-alert">
                Unsupported
              </Badge>
            </span>
          )}
        </p>
      </StatementRow>
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
          // One box round the decisions, so a walkthrough can point at all three (F-12).
          <span
            className="rv-finding-actions"
            data-walk={claim.number === 1 ? 'review.finding-1.decisions' : undefined}
          >
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
                // The one control a walkthrough lets through (see review.css, rv-finding-actions).
                data-walk={claim.number === 1 ? 'review.finding-1.accept' : undefined}
                disabled={busy}
                loading={actions.busy === claim.key}
                onClick={() => actions.onAccept(claim)}
              >
                Accept
              </Button>
            )}
          </span>
        )}
      </div>
      {removed.length > 0 && (
        <p className="rv-finding-note">
          {removed.length === 1
            ? `Its citation to ${describe(removed[0])} was deleted in the document,`
            : `${removed.length} of its citations were deleted in the document,`}{' '}
          so it is unsupported until resolved here.
        </p>
      )}
      {reworded && (
        <details className="rv-finding-original">
          <summary>Drafted text</summary>
          <p>{claim.generatedText}</p>
        </details>
      )}
    </div>
  )
}

// A paragraph of AI-drafted text, its sentences still unsupported marked
// (AS-04 AC3): each one's words, then an Unsupported badge, which a selection
// reads as no text (draftSelection.ts). Formatting and citation markers are
// drawn as in the engineer's own text.
function AiWords({
  content,
  ranges,
  cite,
}: {
  content: DocumentInline[]
  ranges: [number, number][]
  cite: (id: string) => React.ReactNode
}) {
  const shown: React.ReactNode[] = []
  let offset = 0
  for (const [i, c] of content.entries()) {
    if (c.type === 'cite') {
      shown.push(<Fragment key={i}>{cite(c.id)}</Fragment>)
      offset += 1
      continue
    }
    const start = offset
    const end = offset + c.text.length
    const cuts = [
      ...new Set([start, end, ...ranges.flat().filter((at) => at > start && at < end)]),
    ].sort((a, b) => a - b)
    for (let j = 0; j + 1 < cuts.length; j++) {
      const from = cuts[j]
      const to = cuts[j + 1]
      let words: React.ReactNode = c.text.slice(from - start, to - start)
      if (c.marks?.includes('underline')) words = <u>{words}</u>
      if (c.marks?.includes('italic')) words = <em>{words}</em>
      if (c.marks?.includes('bold')) words = <strong>{words}</strong>
      const inside = ranges.some(([a, b]) => from >= a && to <= b)
      shown.push(
        inside ? (
          <mark key={`${i}.${j}`} className="rv-statement-text rv-ai-unsupported">
            {words}
          </mark>
        ) : (
          <span key={`${i}.${j}`} className="rv-statement-text">
            {words}
          </span>
        ),
      )
      if (ranges.some(([, b]) => b === to))
        shown.push(
          <span key={`${i}.${j}.flag`} className="rv-flag">
            <Badge tone="moderate" icon="triangle-alert">
              Unsupported
            </Badge>
          </span>,
        )
    }
    offset = end
  }
  return <>{shown}</>
}

// One paragraph of text drafted from the Ask tab and inserted (AS-04 AC2), in
// violet until the engineer accepts it. Under its first paragraph: who
// inserted it when, and Accept and Delete for the assigned engineer; Accept is
// greyed out while a sentence is unsupported (AC3).
function AiParagraph({
  paragraph,
  draft,
  first,
  still,
  cite,
  attrs,
  actions,
}: {
  paragraph: DocumentParagraph
  draft: AiDraft | undefined
  first: boolean
  // Its proposal's sentences still unsupported, anywhere in its text.
  still: string[]
  cite: (id: string) => React.ReactNode
  attrs: Record<string, string>
  actions?: AiTextActions
}) {
  const ranges = unsupportedRanges(markedText(paragraph.content), still)
  const id = paragraph.ai!
  const busy = actions?.busy != null
  return (
    <div
      role="group"
      aria-label="AI-drafted text"
      className={'rv-ai-text' + (still.length ? ' is-flagged' : '')}
    >
      <p className="rv-statement rv-ai-words" {...attrs}>
        <AiWords content={paragraph.content} ranges={ranges} cite={cite} />
      </p>
      {first && (
        <div className="rv-finding-bar">
          <Badge tone="ai" icon="sparkles">
            AI draft
          </Badge>
          {draft && (
            <span className="rv-finding-by">
              {draft.insertedBy.name} · {formatDayYearTime(new Date(draft.insertedAt))}
            </span>
          )}
          <span className="rv-finding-gap" />
          {actions && (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={IconRegistry.action.discard}
                aria-label="Delete the AI-drafted text"
                disabled={busy}
                onClick={() => actions.onDelete(id)}
              >
                Delete
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={IconRegistry.action.accept}
                aria-label="Accept the AI-drafted text"
                disabled={busy}
                disabledReason={
                  still.length
                    ? {
                        title: 'Unsupported sentences',
                        text: `${plural(still.length, 'sentence')} ${still.length === 1 ? 'has' : 'have'} no supporting source. Give each a citation in the document editor, or delete ${still.length === 1 ? 'it' : 'them'}, first.`,
                      }
                    : undefined
                }
                loading={actions.busy === id}
                onClick={() => actions.onAccept(id)}
              >
                Accept
              </Button>
            </>
          )}
        </div>
      )}
      {first && draft && <p className="rv-finding-note rv-ai-asked">Asked: “{draft.request}”</p>}
    </div>
  )
}

function DraftSubsection({
  sub,
  index,
  blocks,
  claims: all,
  actions,
  ai,
  flaggedAi,
  ...citing
}: Citing & {
  sub: ReviewDraft['subsections'][number]
  // Its place in the section, for writing guidance to go to its note (AS-08).
  index: number
  // The subsection's text: its findings and anything the engineer wrote (RV-08).
  blocks: DocumentBlock[]
  // Every finding in the draft, by which those in `blocks` are shown.
  claims: Claim[]
  actions?: FindingActions
  // Draws AI-drafted text awaiting Accept (AS-04), and which of it is flagged.
  ai: (id: string, paragraph: DocumentParagraph) => React.ReactNode
  flaggedAi: Set<string>
}) {
  const byKey = new Map(all.map((c) => [c.key, c]))
  const claims = textBlocksIn(blocks).flatMap((b) => (b.finding && byKey.get(b.finding)) || [])
  const written = hasWritten(blocks)
  const finding = (key: string, content: DocumentInline[], heading: boolean) => {
    const claim = byKey.get(key)
    return claim ? (
      <Finding claim={claim} actions={actions} content={content} heading={heading} {...citing} />
    ) : null
  }
  if (sub.kind === 'table' || (!sub.statements.length && !written && !claims.length)) {
    return (
      <div className="rv-subsection-note" id={subsectionId(citing.sectionId, index)}>
        <strong>{sub.heading}</strong>
        <p className="rv-muted">
          {sub.kind === 'table'
            ? 'This table is completed from measured values, so it is not drafted.'
            : 'No evidence covers this subsection, so it was left empty.'}
        </p>
      </div>
    )
  }
  if (!claims.length && !written) {
    return (
      <div className="rv-subsection-note" id={subsectionId(citing.sectionId, index)}>
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
    // Text the engineer wrote around the rows follows the table.
    const others = blocks.flatMap((b): DocumentBlock[] => {
      if (b.type === 'paragraph' || b.type === 'heading') return b.finding ? [] : [b]
      const items = b.items.filter((item) => !item.finding)
      return items.length ? [{ ...b, items }] : []
    })
    return (
      <>
        <MaturityTable entries={entries} unplaced={unplaced} />
        {others.length > 0 && (
          <WrittenBlocks
            blocks={others}
            cite={citeMark(citing, null)}
            finding={finding}
            ai={ai}
            attrs={blockAttrs(citing.askText)}
          />
        )}
      </>
    )
  }
  // AI-drafted text from the Ask tab awaiting Accept (AS-04) keeps the box violet.
  const aiBlocks = textBlocksIn(blocks).filter((b) => b.type === 'paragraph' && b.ai)
  const aiIds = aiBlocks.map((b) => (b as DocumentParagraph).ai!)
  const cited = [
    ...new Set([
      ...claims.flatMap((c) => c.citations),
      ...aiBlocks.flatMap((b) => b.content.flatMap((c) => (c.type === 'cite' ? [c.id] : []))),
    ]),
  ]
  const pending = claims.filter((c) => c.review.state === 'pending')
  const unsupported = pending.some((c) => !c.supported) || aiIds.some((id) => flaggedAi.has(id))
  return (
    <AIDraftBlock
      heading={sub.heading}
      // AI chrome while a finding waits for a decision; neutral once the
      // engineer has accepted or edited every one (the words are theirs).
      status={
        pending.length || aiIds.length
          ? unsupported
            ? 'flagged'
            : 'draft'
          : written || claims.some((c) => c.review.state === 'edited')
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
      <WrittenBlocks
        blocks={blocks}
        cite={citeMark(citing, null)}
        finding={finding}
        ai={ai}
        attrs={blockAttrs(citing.askText)}
      />
    </AIDraftBlock>
  )
}

// The draft editor of the review workspace (RV-01 AC1): the selected
// section's saved draft in the template's order. Each citation is a numbered
// button that opens its source in the panel beside the draft (AC7). Each
// finding shows its review decision and, for the assigned engineer, Accept,
// Edit and Reject (RV-02); rejected findings are left out. `header` holds the
// section's review controls; a replacement draft is shown read-only. Version
// history (RV-06) opens the section's versions in its place. With `ask`,
// selecting the draft's text offers Ask about this (AS-02), and Rewrite this
// for the assigned engineer (AS-04). Text drafted from the Ask tab and inserted
// shows in violet, its unsupported sentences marked, with Accept and Delete
// for the assigned engineer (`aiActions`, AS-04).
export function DraftEditor({
  section,
  position,
  onPrevious,
  onNext,
  onGenerate,
  onHistory,
  notice,
  actions,
  header,
  figures,
  ask,
  aiActions,
  ...citing
}: Omit<Citing, 'sectionId' | 'askText'> & {
  section: ReviewSection
  // e.g. "2 of 6"
  position: string
  onPrevious?: () => void
  onNext?: () => void
  onGenerate: () => void
  // Opens the section's version history (RV-06).
  onHistory?: () => void
  // Shown under the heading whatever the section holds, e.g. a restore just made.
  notice?: React.ReactNode
  actions?: FindingActions
  header?: React.ReactNode
  // Sections 4 and 5 (GN-03): the engineer's figures, shown above the draft and
  // before there is one, since they must be entered first. As a function (Section
  // 5), it is given each subsection's findings by heading and lays them out itself,
  // inside Marsh's per-level tables, so they are not listed again below.
  figures?: React.ReactNode | ((drafted: Map<string, React.ReactNode>) => React.ReactNode)
  ask?: DraftAsk
  aiActions?: AiTextActions
}) {
  const { draft, review } = section
  // The box "Ask about this" sits in, by the selection.
  const host = useRef<HTMLDivElement>(null)

  // A claim picked in the panel scrolls its statement into view.
  useEffect(() => {
    if (citing.focus.statement)
      document
        .getElementById(statementId(section.id, citing.focus.statement))
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [section.id, citing.focus.statement])

  const claims = draft ? claimsOf(draft) : []
  // The section's text: its draft's findings, in the engineer's layout and
  // words once changed in the document editor, with what they wrote (RV-08).
  // Read once per section as loaded, so a selection is read against the
  // blocks drawn (AS-02).
  const content = useMemo(() => sectionContent(section), [section])
  const askText = useMemo(() => contentText(section.id, content), [section.id, content])
  const saved = section.document
  const byKey = new Map(claims.map((c) => [c.key, c]))
  // Text drafted from the Ask tab awaiting Accept (AS-04): each insertion,
  // and its sentences still unsupported.
  const aiDrafts = section.aiDrafts ?? []
  const stillUnsupported = unsupportedIn(content, aiDrafts)
  const flaggedAi = new Set(stillUnsupported.keys())
  // The first paragraph of each insertion, in the section's order, carries its bar.
  const firstAi = new Set<DocumentParagraph>()
  const barred = new Set<string>()
  for (const b of textBlocksIn([...content.intro, ...content.subsections.flatMap((x) => x.blocks)]))
    if (b.type === 'paragraph' && b.ai && !barred.has(b.ai)) {
      barred.add(b.ai)
      firstAi.add(b)
    }
  const ai = (id: string, paragraph: DocumentParagraph) => (
    <AiParagraph
      paragraph={paragraph}
      draft={aiDrafts.find((d) => d.id === id)}
      first={firstAi.has(paragraph)}
      still={stillUnsupported.get(id) ?? []}
      cite={citeMark(citing, null)}
      attrs={blockAttrs(askText)(paragraph)}
      actions={aiActions}
    />
  )
  const blocksOf = (blocks: DocumentBlock[]) => (
    <WrittenBlocks
      blocks={blocks}
      cite={citeMark(citing, null)}
      attrs={blockAttrs(askText)}
      ai={ai}
      finding={(key, words, heading) => {
        const claim = byKey.get(key)
        return claim ? (
          <Finding
            claim={claim}
            actions={actions}
            content={words}
            heading={heading}
            sectionId={section.id}
            askText={askText}
            {...citing}
          />
        ) : null
      }}
    />
  )
  const placesFindings = typeof figures === 'function'
  // Each subsection's findings and text, for figures that place them; a
  // subsection with neither is left out, so it reads as not drafted.
  const drafted = new Map<string, React.ReactNode>(
    (draft?.subsections ?? []).flatMap((sub, i) => {
      const blocks = content.subsections[i]?.blocks ?? []
      return blocks.length ? [[sub.heading, blocksOf(blocks)] as const] : []
    }),
  )
  // Saved from the document editor, and when; or set aside as the section was
  // drafted again since.
  const documentLine = saved?.current && (
    <p className="rv-provenance">
      Last saved in the document {formatDayTime(new Date(saved.savedAt))} by {saved.savedBy.name}
    </p>
  )
  // AI-drafted text to review (AS-04 AC2, AC3), above the section's text.
  const unsupportedAi = [...stillUnsupported.values()].reduce((n, s) => n + s.length, 0)
  const aiNotice = aiDrafts.length > 0 && (
    <Callout
      tone={unsupportedAi ? 'warning' : 'info'}
      title={
        aiDrafts.length === 1
          ? 'AI-drafted text to review'
          : `${aiDrafts.length} pieces of AI-drafted text to review`
      }
    >
      Text drafted from the Ask tab is in violet until you accept it.{' '}
      {unsupportedAi > 0 &&
        `${plural(unsupportedAi, 'sentence')} of it ${unsupportedAi === 1 ? 'has' : 'have'} no supporting source and ${unsupportedAi === 1 ? 'is' : 'are'} marked Unsupported: give each a citation in the document editor, or delete it. Until then the report can't be exported.`}
    </Callout>
  )
  const setAside = saved && !saved.current && (
    <Callout
      tone="info"
      title="Drafted again since your document edits"
      actions={
        onHistory && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={IconRegistry.object.history}
            onClick={onHistory}
          >
            Open version history
          </Button>
        )
      }
    >
      Your text saved in the document {formatDayTime(new Date(saved.savedAt))} was written on an
      earlier draft. Findings you edited were carried into this draft; text you wrote yourself is
      kept in that saved version, not shown here. The version history shows it and can restore it.
    </Callout>
  )
  return (
    <section aria-label="Draft editor" className="om-scroll rv-editor">
      <div className="rv-editor-inner rv-ask-host" ref={host}>
        {ask && askText.blocks.length > 0 && (
          <AskSelection
            host={host}
            text={askText}
            label={ask.label}
            onAsk={ask.onAsk}
            onRewrite={ask.onRewrite}
            shown={ask.shown?.sectionId === section.id ? ask.shown : null}
            blocked={ask.blocked}
          />
        )}
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
          {onHistory && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={IconRegistry.object.history}
              data-walk="review.version-history"
              onClick={onHistory}
            >
              Version history
            </Button>
          )}
        </div>
        <h2>
          {section.id}. {section.title}
        </h2>
        {notice}
        {placesFindings ? figures(drafted) : figures}
        {!draft && hasWritten(content.intro) ? (
          // Not drafted, but written in the document editor (RV-08 AC3).
          <>
            {documentLine}
            {aiNotice}
            <Callout tone="info" title="Written by you">
              This section was not drafted: its text is yours, from the document editor. Draft it on
              the Generation tab only to replace it with an AI draft to review.
            </Callout>
            <div className="rv-written-section">{blocksOf(content.intro)}</div>
          </>
        ) : !draft ? (
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
            {documentLine}
            {header}
            {setAside}
            {aiNotice}
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
                assessment or its standards: no citation, a source that could not be found, only a
                past report, or a citation deleted in the document.{' '}
                {review.unsupportedStatements === 1 ? 'It is' : 'They are'} marked Unsupported, even
                once accepted, until rejected.
              </Callout>
            )}
            {draft.questions.length > 0 && (
              <Callout tone="info" title="Questions for the engineer">
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {draft.questions.map((q, n) => (
                    // AS-06: counted as seen once it stays on screen (marshbot/useActivity);
                    // must match server/src/services/assistant/checks/unseen-questions.ts.
                    <li key={q} data-activity-key={`question:${draft.id}:${n}`}>
                      {q}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {hasWritten(content.intro) && (
              <div className="rv-written-section">{blocksOf(content.intro)}</div>
            )}
            {!placesFindings &&
              draft.subsections.map((sub, i) => (
                <DraftSubsection
                  key={sub.heading}
                  sub={sub}
                  index={i}
                  blocks={content.subsections[i]?.blocks ?? []}
                  claims={claims}
                  actions={actions}
                  ai={ai}
                  flaggedAi={flaggedAi}
                  sectionId={section.id}
                  askText={askText}
                  {...citing}
                />
              ))}
          </>
        )}
      </div>
    </section>
  )
}
