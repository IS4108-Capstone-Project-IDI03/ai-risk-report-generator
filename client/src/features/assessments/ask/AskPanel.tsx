import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  ConfidenceIndicator,
  Dialog,
  EmptyState,
  EvidenceCitation,
  Icon,
  IconButton,
  Select,
  Textarea,
  toast,
  type Reason,
} from '../../../design-system'
import type { FieldObservation, ReviewWorkspace, SourcePassage } from '../api'
import type { CommentAnchor } from '../comments/api'
import { CitationMark } from '../components/CitationMark'
import { useSave } from '../components/useSave'
import { formatTimeOfDay } from '../format'
import { excerpt, pageLocator, severityLabel } from '../reviewDisplay'
import { DictateButton } from '../dictation/DictateButton'
import { Tip } from '../../help/Tip'
import { useWalkthroughs } from '../../walkthrough/engine'
import type {
  AskCitation,
  AskConversation,
  AskStatement,
  GapLink,
  GuideKind,
  Proposal,
  SectionGap,
  TemplatePart,
} from './api'
import { quotedWords, type AskPassage } from './passage'
import { STOPPED, type AskItem, type AskWorkflow } from './useAsk'
import './ask.css'

const MAX_QUESTION = 1000

// The question the Ask walkthrough (F-12) types in for the person on its step 2; its words name it.
const WALK_QUESTION = 'Which observations concern fire protection?'

const KIND_LABEL: Record<AskCitation['kind'], string> = {
  observation: 'Site observation',
  standard: 'External standard',
  report: 'Past report',
  template: 'Report template',
}

// A cited source of an answer, as the evidence panel opens it; a part of the
// report template (AS-08) opens where it sits in the section instead.
type AskSource =
  | { ref: string; kind: 'observation'; observation: FieldObservation }
  | { ref: string; kind: 'standard' | 'report'; passage: SourcePassage }
  | { ref: string; kind: 'template'; part: TemplatePart }

/** An answer's cited sources by citation ID, once its result has arrived. */
function sourcesOf(item: AskItem): Map<string, AskSource> {
  const found = new Map<string, AskSource>()
  for (const p of item.passages)
    found.set(p.id, { ref: p.id, kind: p.kind === 'precedent' ? 'report' : 'standard', passage: p })
  for (const o of item.observations)
    found.set(`O:${o.id}`, { ref: `O:${o.id}`, kind: 'observation', observation: o })
  for (const t of item.template ?? []) found.set(t.id, { ref: t.id, kind: 'template', part: t })
  return found
}

// What a template part is, as its source line says it.
const PART_KIND: Record<TemplatePart['kind'], string> = {
  section: 'The whole section',
  narrative: 'Written text',
  fields: 'Fields',
  table: 'Table',
}

/** Returns where a template citation (`T:9` or `T:9.3`) goes: its section, at the part. */
export function templateLink(ref: string, part?: TemplatePart): GapLink {
  const [sectionId, index] = ref.slice(2).split('.')
  const subsection = part?.subsection ?? (index === undefined ? null : Number(index))
  return {
    to: 'section',
    sectionId: part?.sectionId ?? sectionId,
    ...(subsection !== null && !Number.isNaN(subsection) && { subsection }),
  }
}

// The answer's sources in the order its statements first cite them, numbered from 1.
function citedOrder(item: AskItem): AskCitation[] {
  const seen = new Map<string, AskCitation>()
  for (const s of item.statements)
    for (const c of s.citations) {
      const known = seen.get(c.ref)
      // A source is unverified if any of its quotes was not found in it; else it
      // is marked as the AI's reading if any quote is from a picture's
      // description (KB-02).
      if (!known) seen.set(c.ref, c)
      else if (notFound(c)) seen.set(c.ref, { ...known, verified: false, described: false })
      else if (c.described && !notFound(known))
        seen.set(c.ref, { ...known, verified: false, described: true })
    }
  return [...seen.values()]
}

// A quote nowhere in its source: one only in a picture's AI description is cited, not lost.
const notFound = (c: AskCitation) => !c.verified && !c.described

function sourceName(source: AskSource | undefined, citation: AskCitation): string {
  if (!source) return KIND_LABEL[citation.kind]
  if (source.kind === 'observation') return source.observation.location ?? 'Location not recorded'
  if (source.kind === 'template')
    return source.part.heading ? `${source.part.label} › ${source.part.heading}` : source.part.label
  return source.passage.document?.title ?? source.passage.documentId ?? 'Document not found'
}

const STEP_TEXT = {
  retrieve: 'Searching the observations, selected standards and past reports…',
  generate: 'Writing the answer…',
}
// What a section should cover (AS-08), which reads the template and searches
// the selected standards only.
const COVER_STEP_TEXT = {
  retrieve: 'Reading the report template and searching the selected standards…',
  generate: 'Writing the answer…',
}
// For proposed text (AS-04), which searches no past report.
const DRAFT_STEP_TEXT = {
  retrieve: 'Searching the observations and the standards in the drafting set…',
  generate: 'Writing the text…',
}

// A passage quoted longer than this folds, with a way to read all of it.
const FOLD_AT = 280

// A passage selected in the draft (AS-02), quoted verbatim behind a 2px rule
// (AC2): under the section it is in, with a link back to it while it is in the
// text and "Text deleted" once it is not (AC3). In the question box it can be
// taken off again.
function PassageQuote({
  passage,
  heading,
  found,
  onShow,
  onRemove,
}: {
  passage: AskPassage
  heading: string
  // Whether its text is still in the report; undefined where that is not known.
  found?: boolean
  onShow?: () => void
  onRemove?: () => void
}) {
  const [whole, setWhole] = useState(false)
  const words = quotedWords(passage.anchor.exact)
  const long = words.length > FOLD_AT || words.split('\n').length > 4
  return (
    <figure className="ask-passage" aria-label={heading}>
      <figcaption className="ask-passage-head">
        <span className="ask-passage-from">{heading}</span>
        {found === false ? (
          <span className="ask-tag">Text deleted</span>
        ) : (
          found &&
          onShow && (
            <button type="button" className="ask-link" onClick={onShow}>
              Go to the passage
            </button>
          )
        )}
        {onRemove && (
          <IconButton
            icon="x"
            size="sm"
            label="Don't ask about this passage"
            tooltip="Remove the passage"
            onClick={onRemove}
          />
        )}
      </figcaption>
      <blockquote className={'ask-passage-text' + (long && !whole ? ' is-folded' : '')}>
        {words}
      </blockquote>
      {long && (
        <button
          type="button"
          className="ask-link"
          aria-expanded={whole}
          onClick={() => setWhole((open) => !open)}
        >
          {whole ? 'Show less' : 'Show the whole passage'}
        </button>
      )}
    </figure>
  )
}

// One answer in AI violet (AC2): each statement with its citation numbers,
// what evidence is missing (AC4), its confidence (AC5), why it stopped (AC8),
// and its sources as EvidenceCitations. Selecting a citation or a source opens
// it in the evidence panel.
function Answer({
  item,
  current,
  onCite,
  onAskAgain,
  canAsk,
  walk,
}: {
  item: AskItem
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  onAskAgain: (question: string, passage: AskPassage | null) => void
  canAsk: boolean
  // The walkthrough tag, on the newest answer only (F-12).
  walk?: string
}) {
  const answering = item.status === 'answering'
  const order = citedOrder(item)
  const number = new Map(order.map((c, n) => [c.ref, n + 1]))
  const sources = sourcesOf(item)
  const failedAt = item.failure ? formatTimeOfDay(new Date(item.failure.at)) : null
  const steps = item.guidance?.kind === 'cover' ? COVER_STEP_TEXT : STEP_TEXT
  return (
    <article
      className="ask-answer"
      aria-label={`Answer to: ${item.question}`}
      aria-busy={answering || undefined}
      data-walk={walk}
    >
      <div className="ask-answer-head">
        <Icon name="sparkles" size={14} color="var(--ai-fg)" />
        <span className="ask-answer-title">Answer</span>
        <span />
        {item.confidence && (
          <>
            <ConfidenceIndicator level={item.confidence} />
            <Tip id="ask.confidence" align="right" />
          </>
        )}
      </div>
      {answering && item.step && (
        <p className="ask-step" role="status">
          <span className="ask-dot" aria-hidden="true" />
          {steps[item.step]}
        </p>
      )}
      {item.statements.length > 0 && (
        <div className="ask-statements">
          {item.statements.map((s, i) => (
            // Where the passage's sources disagree, each figure with its source,
            // neither chosen (AS-02 AC4).
            <p key={i} className={s.differs ? 'ask-statement ask-differs' : 'ask-statement'}>
              {s.differs && (
                <span className="ask-differs-label">
                  <Icon name="git-compare-arrows" size={14} color="var(--text-secondary)" />
                  Sources disagree:{' '}
                </span>
              )}
              {s.text}{' '}
              {s.citations.map((c) => (
                <CitationMark
                  key={c.ref}
                  number={number.get(c.ref)!}
                  label={`${KIND_LABEL[c.kind]}, ${sourceName(sources.get(c.ref), c)}`}
                  current={current === c.ref}
                  onSelect={() => onCite(c.ref, item)}
                />
              ))}
            </p>
          ))}
        </div>
      )}
      {item.missing.map((m, i) => (
        <p key={i} className="ask-missing">
          <Icon name="circle-help" size={14} color="var(--text-muted)" />
          <span>
            <span className="ask-missing-label">Evidence missing: </span>
            {m}
          </span>
        </p>
      ))}
      {item.failure && (
        // The engineer's own Stop is no error, so it isn't shown in red or announced as one.
        <div role={item.failure.cause === STOPPED ? 'status' : 'alert'}>
          <Callout
            tone={item.failure.cause === STOPPED ? 'info' : 'danger'}
            title={
              item.failure.cause === STOPPED ? 'You stopped this answer' : 'The answer stopped'
            }
            actions={
              canAsk ? (
                <Button
                  pill
                  variant="secondary"
                  size="sm"
                  iconLeft="rotate-ccw"
                  onClick={() => onAskAgain(item.question, item.passage ?? null)}
                >
                  Ask again
                </Button>
              ) : undefined
            }
          >
            Answer stopped at {failedAt}: {item.failure.cause}. {item.failure.next}
          </Callout>
        </div>
      )}
      {!answering && order.length > 0 && (
        <SourceList
          order={order}
          number={number}
          sources={sources}
          current={current}
          onOpen={(ref) => onCite(ref, item)}
        />
      )}
    </article>
  )
}

// What the Ask tab may do with proposed text (AS-04), given only to whoever
// may put text into the report (the assigned engineer, AC5): the section
// "Draft text" drafts into, why Insert, Replace and Undo can't be used now,
// and what is shown once they were.
export type AskDrafting = {
  // The section open, if it is one of Sections 4 to 12; else null.
  target: { sectionId: string; label: string } | null
  // e.g. the document editor has unsaved changes.
  blocked?: Reason
  // The review workspace with the section's new version, and the proposal.
  onApplied: (workspace: ReviewWorkspace, proposal: Proposal, item: AskItem) => void
}

// The sentences of proposed text, from its proposal once saved, or as they
// stream in, each unsupported one marked (AC3).
function sentencesOf(item: AskItem): (AskStatement & { supported: boolean; paragraph: number })[] {
  if (item.proposal) return item.proposal.sentences
  return item.statements.map((s) => ({
    ...s,
    supported: s.supported !== false && s.citations.length > 0,
    paragraph: s.paragraph ?? 0,
  }))
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Where proposed text stands once it was put into the section, in words.
function settledLine(proposal: Proposal, label: string): string | null {
  const at = (when: string) => formatTimeOfDay(new Date(when))
  if (proposal.settled?.action === 'accepted')
    return `Accepted in ${label} at ${at(proposal.settled.at)}.`
  if (proposal.settled?.action === 'deleted')
    return `Deleted from ${label} at ${at(proposal.settled.at)}.`
  if (proposal.settled?.action === 'undone')
    return `Undone at ${at(proposal.settled.at)}: the text before it is back in ${label}.`
  if (proposal.inserted)
    return `${proposal.kind === 'draft' ? 'Inserted into' : 'Replaced in'} ${label} at ${at(proposal.inserted.at)}, as AI draft to accept once checked.`
  return null
}

// Text drafted or rewritten for a section (AS-04 AC1), in AI violet: a rewrite
// as before and after, each sentence with its citation numbers and any with
// no supporting source marked Unsupported (AC3), what evidence is missing,
// and its sources. The section is unchanged until Insert or Replace; once in,
// Undo restores the text before (AC2). Those are offered only with `drafting`
// (AC5). A refusal says why, and when the section changed since (AC6) offers
// to draft the text again.
function ProposalCard({
  item,
  ask,
  drafting,
  current,
  onCite,
}: {
  item: AskItem
  ask: AskWorkflow
  drafting?: AskDrafting
  current: string | null
  onCite: (ref: string, item: AskItem) => void
}) {
  const proposal = item.proposal ?? null
  const kind = proposal?.kind ?? item.requested?.kind ?? 'draft'
  const label = proposal?.label ?? item.passage?.label ?? drafting?.target?.label ?? 'the section'
  const answering = item.status === 'answering'
  const sentences = sentencesOf(item)
  const order = citedOrder(item)
  const number = new Map(order.map((c, n) => [c.ref, n + 1]))
  const sources = sourcesOf(item)
  const paragraphs = [...new Set(sentences.map((s) => s.paragraph))].sort((a, b) => a - b)
  const unsupported = sentences.filter((s) => !s.supported).length
  const choices = proposal?.choices ?? []
  const [into, setInto] = useState<number | null>(null)
  const chosen = into ?? proposal?.subsection ?? choices[0]?.index ?? -1
  const busy = ask.applying === item.key
  const failedAt = item.failure ? formatTimeOfDay(new Date(item.failure.at)) : null
  const apply = async (action: 'insert' | 'replace' | 'undo') => {
    const done = await ask.apply(item, action, action === 'insert' ? chosen : undefined)
    if (done && drafting) drafting.onApplied(done.workspace, done.proposal, item)
  }
  const redraft =
    drafting && !ask.busy && !ask.archived ? (
      <Button
        pill
        variant="secondary"
        size="sm"
        iconLeft="refresh-cw"
        onClick={() => ask.redraft(item)}
      >
        Draft again
      </Button>
    ) : undefined
  const settled = proposal && settledLine(proposal, label)
  return (
    <article
      className="ask-answer ask-proposal"
      aria-label={`${kind === 'draft' ? 'Proposed text' : 'Proposed rewrite'}: ${item.question}`}
      aria-busy={answering || undefined}
    >
      <div className="ask-answer-head">
        <Icon name="sparkles" size={14} color="var(--ai-fg)" />
        <span className="ask-answer-title">
          {kind === 'draft' ? 'Proposed text' : 'Proposed rewrite'} · {label}
        </span>
      </div>
      {answering && item.step && (
        <p className="ask-step" role="status">
          <span className="ask-dot" aria-hidden="true" />
          {DRAFT_STEP_TEXT[item.step]}
        </p>
      )}
      {kind === 'rewrite' && proposal?.before && (
        <figure className="ask-before" aria-label="Before">
          <figcaption className="ask-before-label">Before</figcaption>
          <blockquote className="ask-before-text">{proposal.before}</blockquote>
        </figure>
      )}
      {sentences.length > 0 && (
        <div
          className="ask-proposed"
          role="group"
          aria-label={kind === 'rewrite' ? 'After' : 'Proposed text'}
        >
          {kind === 'rewrite' && <p className="ask-before-label">After</p>}
          {paragraphs.map((n) => (
            <p key={n} className="ask-proposed-text">
              {sentences
                .filter((s) => s.paragraph === n)
                .map((s, i) => (
                  <span key={i} className={s.supported ? undefined : 'ask-unsupported'}>
                    {i > 0 && ' '}
                    {s.text}
                    {s.citations.map((c) => (
                      <CitationMark
                        key={c.ref}
                        number={number.get(c.ref)!}
                        label={`${KIND_LABEL[c.kind]}, ${sourceName(sources.get(c.ref), c)}`}
                        current={current === c.ref}
                        onSelect={() => onCite(c.ref, item)}
                      />
                    ))}
                    {!s.supported && (
                      <span className="rv-flag">
                        <Badge tone="moderate" icon="triangle-alert">
                          Unsupported
                        </Badge>
                      </span>
                    )}
                  </span>
                ))}
            </p>
          ))}
        </div>
      )}
      {!answering && unsupported > 0 && (
        <p className="ask-proposal-note">
          {plural(unsupported, 'sentence')} {unsupported === 1 ? 'has' : 'have'} no supporting
          source. Inserted, {unsupported === 1 ? 'it stays' : 'they stay'} marked Unsupported and
          the report can't be exported until each is given a citation or deleted.
        </p>
      )}
      {item.missing.map((m, i) => (
        <p key={i} className="ask-missing">
          <Icon name="circle-help" size={14} color="var(--text-muted)" />
          <span>
            <span className="ask-missing-label">Evidence missing: </span>
            {m}
          </span>
        </p>
      ))}
      {item.failure && (
        <div role={item.failure.cause === STOPPED ? 'status' : 'alert'}>
          <Callout
            tone={item.failure.cause === STOPPED ? 'info' : 'danger'}
            title={item.failure.cause === STOPPED ? 'You stopped this text' : 'The text stopped'}
            actions={redraft}
          >
            Text stopped at {failedAt}: {item.failure.cause}. {item.failure.next}
          </Callout>
        </div>
      )}
      {item.refusal && (
        <div role="alert">
          <Callout
            tone="warning"
            title={item.refusal.stale ? 'The section changed' : 'Not done'}
            actions={item.refusal.stale ? redraft : undefined}
          >
            Refused at {formatTimeOfDay(new Date(item.refusal.at))}: {item.refusal.cause}.{' '}
            {item.refusal.next}
          </Callout>
        </div>
      )}
      {proposal?.status === 'proposed' && drafting && (
        <div className="ask-proposal-actions">
          {kind === 'draft' && choices.length > 1 && (
            <div className="ask-proposal-into">
              <Select
                aria-label="Insert into"
                size="sm"
                value={String(chosen)}
                options={choices.map((c) => ({ value: String(c.index), label: c.heading }))}
                disabled={busy}
                onChange={(event) => setInto(Number(event.target.value))}
              />
            </div>
          )}
          {kind === 'draft' && choices.length === 1 && (
            <span className="rv-muted ask-proposal-where">At the end of {choices[0].heading}</span>
          )}
          <span className="ask-proposal-gap" />
          <Button
            pill
            variant="primary"
            size="sm"
            iconLeft={kind === 'draft' ? 'text-cursor-input' : 'replace'}
            loading={busy}
            disabledReason={drafting.blocked}
            onClick={() => void apply(kind === 'draft' ? 'insert' : 'replace')}
          >
            {kind === 'draft' ? 'Insert' : 'Replace'}
          </Button>
        </div>
      )}
      {settled && (
        <p className="ask-proposal-status" role="status">
          <Icon
            name={proposal?.settled ? 'circle-check' : 'sparkles'}
            size={14}
            color={proposal?.settled ? 'var(--text-muted)' : 'var(--ai-fg)'}
          />
          <span>{settled}</span>
          {proposal?.canUndo && drafting && (
            <Button
              pill
              variant="ghost"
              size="sm"
              iconLeft="undo-2"
              loading={busy}
              disabledReason={drafting.blocked}
              onClick={() => void apply('undo')}
            >
              Undo
            </Button>
          )}
        </p>
      )}
      {!answering && order.length > 0 && (
        <SourceList
          order={order}
          number={number}
          sources={sources}
          current={current}
          onOpen={(ref) => onCite(ref, item)}
        />
      )}
    </article>
  )
}

// An answer's or proposal's cited sources, numbered as its statements first
// cite them, each opening in the evidence panel.
function SourceList({
  order,
  number,
  sources,
  current,
  onOpen,
}: {
  order: AskCitation[]
  number: Map<string, number>
  sources: Map<string, AskSource>
  current: string | null
  onOpen: (ref: string) => void
}) {
  return (
    <section className="ask-sources" aria-label="Sources">
      <h4 className="rv-label">Sources</h4>
      <ul className="rv-panel-list">
        {order.map((c) => {
          const source = sources.get(c.ref)
          const passage =
            source?.kind === 'standard' || source?.kind === 'report' ? source.passage : null
          const observation = source?.kind === 'observation' ? source.observation : null
          const part = source?.kind === 'template' ? source.part : null
          return (
            <li key={c.ref}>
              <EvidenceCitation
                index={number.get(c.ref)}
                kind={c.kind}
                source={
                  <>
                    {sourceName(source, c)}
                    {notFound(c) ? (
                      <span className="rv-flag">
                        <Badge tone="moderate" icon="triangle-alert">
                          Quote not found
                        </Badge>
                      </span>
                    ) : (
                      c.described && (
                        <span className="rv-flag">
                          <Badge tone="info" icon="info">
                            AI reading of figure
                          </Badge>
                        </span>
                      )
                    )}
                  </>
                }
                locator={
                  passage
                    ? (pageLocator(passage) ?? undefined)
                    : observation
                      ? severityLabel(observation.severity || 'not set')
                      : part
                        ? PART_KIND[part.kind]
                        : undefined
                }
                excerpt={
                  c.quote
                    ? `“${c.quote}”`
                    : passage
                      ? excerpt(passage.text)
                      : observation?.note
                        ? excerpt(observation.note)
                        : part
                          ? excerpt(part.text)
                          : undefined
                }
                onOpen={() => onOpen(c.ref)}
                style={
                  current === c.ref
                    ? {
                        border: '1px solid var(--border-focus)',
                        background: 'var(--surface-selected)',
                      }
                    : undefined
                }
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Writing guidance in the Ask tab (AS-08): the part of the report open, which
// the two buttons ask about, and going to where a gap is finished or a cited
// template part sits. Given to anyone who can ask.
export type AskGuidanceTarget = {
  // The part open, as the report heads it; null when none is.
  target: { sectionId: string; label: string } | null
  onGo: (link: GapLink) => void
}

// Which parts each button asks about (as the gateway's section-guidance.service).
const COVER_SECTIONS = /^(1[0-2]|[4-9])$/
const MISSING_SECTIONS = /^(1[0-2]|[2-9])$/

// Why a guidance button can't be used for the part open, if it can't.
function guideBlocked(kind: GuideKind, target: AskGuidanceTarget['target']): Reason | undefined {
  if (!target)
    return { title: 'No section open', text: 'Open a section of the report to ask about it.' }
  if (kind === 'cover' && !COVER_SECTIONS.test(target.sectionId))
    return {
      title: 'Not for this part',
      text: 'The report template defines Sections 4 to 12. Open one of them to ask what it should cover.',
    }
  if (kind === 'missing' && !MISSING_SECTIONS.test(target.sectionId))
    return {
      title: 'Not for this part',
      text: `${target.label} is filled in from the assessment. Open one of Sections 2 to 12 to ask what is missing from it.`,
    }
  return undefined
}

const goLabel = (link: GapLink) =>
  link.to === 'section'
    ? 'Go to section'
    : link.observationId
      ? 'Go to observation'
      : 'Go to observations'

function GapGroup({
  title,
  gaps,
  onGo,
}: {
  title: string
  gaps: SectionGap[]
  onGo?: (link: GapLink) => void
}) {
  return (
    <section className="ask-gap-group" aria-label={title}>
      <h4 className="rv-label ask-gap-head">
        {title} <span className="ask-gap-count">{gaps.length}</span>
      </h4>
      <ul className="ask-gap-list">
        {gaps.map((gap, i) => (
          <li key={i} className={gap.blocksExport ? 'ask-gap is-blocking' : 'ask-gap'}>
            <span className="ask-gap-fact">{gap.fact}</span>
            {onGo && (
              <button
                type="button"
                className="ask-link"
                aria-label={`${goLabel(gap.link)}: ${gap.fact}`}
                onClick={() => onGo(gap.link)}
              >
                {goLabel(gap.link)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// What is missing from a section (AS-08 AC2), as the gateway listed it when
// asked: those that block the export first, as the Export tab lists them (AC3),
// then the rest, each a fact (AC4) with Go to section or Go to observation.
// Worked out with no AI, so it sits in grey, not AI violet.
function GapList({
  item,
  onGo,
  onAskAgain,
  canAsk,
}: {
  item: AskItem
  onGo?: (link: GapLink) => void
  onAskAgain: () => void
  canAsk: boolean
}) {
  const gaps = item.gaps ?? []
  const label = item.guidance?.label ?? 'the section'
  const blocking = gaps.filter((g) => g.blocksExport)
  const others = gaps.filter((g) => !g.blocksExport)
  const checking = item.status === 'answering'
  return (
    <article
      className="ask-gaps"
      aria-label={`Answer to: ${item.question}`}
      aria-busy={checking || undefined}
    >
      <div className="ask-gaps-top">
        <Icon name="list-x" size={14} color="var(--text-secondary)" />
        <span className="ask-gaps-title">Missing from {label}</span>
        <span />
        {!checking && !item.failure && (
          <span className="ask-gaps-at">As of {formatTimeOfDay(new Date(item.askedAt))}</span>
        )}
      </div>
      {checking ? (
        <p className="ask-gaps-checking" role="status">
          Checking {label}…
        </p>
      ) : item.failure ? (
        <div role="alert">
          <Callout
            tone="danger"
            title="The check stopped"
            actions={
              canAsk ? (
                <Button
                  pill
                  variant="secondary"
                  size="sm"
                  iconLeft="rotate-ccw"
                  onClick={onAskAgain}
                >
                  Check again
                </Button>
              ) : undefined
            }
          >
            Check stopped at {formatTimeOfDay(new Date(item.failure.at))}: {item.failure.cause}.{' '}
            {item.failure.next}
          </Callout>
        </div>
      ) : gaps.length === 0 ? (
        <p className="ask-gaps-none">Nothing is missing from {label}.</p>
      ) : (
        <>
          {blocking.length > 0 && (
            <GapGroup title="Blocks the export" gaps={blocking} onGo={onGo} />
          )}
          {others.length > 0 && (
            <GapGroup
              title={blocking.length ? 'Also missing' : 'Missing'}
              gaps={others}
              onGo={onGo}
            />
          )}
        </>
      )}
      {!checking && !item.failure && (
        <p className="ask-gaps-note">
          Listed from the report as saved, with no AI. The Export tab lists the same blockers.
        </p>
      )}
    </article>
  )
}

// Why the conversation can't be changed while an answer is written.
const ANSWERING: Reason = {
  title: 'An answer is being written',
  text: 'Wait for it to finish, or stop it, to change conversation.',
}
// Why nothing more can be asked while an answer is written (AS-08's buttons).
const ANSWERING_NOW: Reason = {
  title: 'An answer is being written',
  text: 'Wait for it to finish, or stop it, to ask again.',
}

// The conversation picker (AS-03 AC2): this user's conversations on the
// assessment, latest first, by first question and when last asked, with New
// conversation and Delete beside it. Shown once there is one. On an archived
// assessment they are only read (AC5): it only switches between them.
function ConversationBar({ ask, onDelete }: { ask: AskWorkflow; onDelete: () => void }) {
  const { conversations, conversation } = ask
  if (!conversations.length) return null
  const options = [
    // A new conversation is listed once its first question is asked.
    ...(conversation ? [] : [{ value: '', label: 'New conversation' }]),
    ...conversations.map((c) => ({
      value: c.id,
      label: `${c.title} · ${formatTimeOfDay(new Date(c.lastAskedAt))}`,
    })),
  ]
  const blocked = ask.busy ? ANSWERING : undefined
  return (
    <div className="ask-conversations" role="group" aria-label="Conversations">
      <div className="ask-conversation-pick">
        <Select
          aria-label="Conversation"
          size="sm"
          value={conversation?.id ?? ''}
          options={options}
          disabled={ask.busy || ask.switching}
          onChange={(event) => {
            if (event.target.value) void ask.open(event.target.value)
          }}
        />
      </div>
      {!ask.archived && (
        <>
          <IconButton
            icon="plus"
            size="sm"
            variant="outline"
            label="New conversation"
            tooltip="New conversation"
            // Already a new, empty one: there is nothing more to start.
            disabled={!conversation && ask.items.length === 0}
            disabledReason={blocked}
            onClick={ask.startNew}
          />
          {conversation && (
            <IconButton
              icon="trash-2"
              size="sm"
              variant="outline"
              label="Delete conversation"
              tooltip="Delete this conversation"
              style={blocked ? undefined : { color: 'var(--red-600)' }}
              disabledReason={blocked}
              onClick={onDelete}
            />
          )}
        </>
      )}
    </div>
  )
}

function deletedWhat(questions: number) {
  if (questions === 0) return 'It is deleted for good.'
  const what =
    questions === 1 ? 'Its question and answer are' : `Its ${questions} questions and answers are`
  return `${what} deleted for good and can't be opened again.`
}

// The confirmation before a conversation is deleted (AS-03 AC2), with what
// goes with it. Cancel is the safe choice; a delete that fails keeps the
// dialog open with the reason.
function DeleteConversationDialog({
  conversation,
  questions,
  onDelete,
  onClose,
}: {
  conversation: AskConversation
  questions: number
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useSave()
  // Focus starts on Cancel, not on the Close button a native dialog picks
  // first (as a saved chat's delete, CB-03). Set one tick after it opens.
  const buttons = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => buttons.current?.querySelector('button')?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Dialog
      title="Delete this conversation?"
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <span ref={buttons} className="ask-delete-actions">
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            pill
            variant="danger"
            iconLeft="trash-2"
            loading={busy}
            onClick={() => run(onDelete)}
          >
            Delete conversation
          </Button>
        </span>
      }
    >
      <div className="ask-delete">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Conversation not deleted">
              {problem}
            </Callout>
          </div>
        )}
        <p className="ask-delete-title">{conversation.title}</p>
        <p>{deletedWhat(questions)} Nothing in the report changes.</p>
      </div>
    </Dialog>
  )
}

// What a new question searches (AC3), in a sentence.
function scopeLine(ask: AskWorkflow) {
  const scope = ask.scope
  if (!scope)
    return 'Searches this assessment’s observations, its selected standards and matching past reports.'
  const standards = scope.standards.length
  const from =
    scope.standardsFrom === 'checklist' ? ' kept on its checklist' : ' that apply to the site'
  return (
    `Searches its ${scope.observations} observation${scope.observations === 1 ? '' : 's'}, ` +
    `${standards} standard${standards === 1 ? '' : 's'}${standards ? from : ''} and ` +
    `${scope.pastReports} past report${scope.pastReports === 1 ? '' : 's'} on ` +
    `${scope.facilityType} sites in ${scope.jurisdiction}.`
  )
}

// The Ask tab (AS-01): this engineer's questions about the assessment and
// their cited answers, newest last, then the question box. Questions are kept
// in conversations (AS-03): the tab opens on the latest, the picker above
// opens another, starts a new one or deletes one after confirming; on an
// archived assessment they are only read. Without the gateway (`ask` null)
// it says it is unavailable and why (AC7). A
// question about a passage selected in the draft (AS-02) quotes it, in the
// question box and above the question once asked; `locate` says whether its
// text is still there and `onShowPassage` goes back to it. With `drafting`
// (the assigned engineer, AS-04), Draft text asks for text for the open
// section instead of an answer, a passage chosen with Rewrite this is
// rewritten, and proposed text can be inserted, replaced and undone. With
// `guidance` (AS-08), two buttons ask what the open section should cover and
// what is missing from it; a gap's link, or a cited part of the template, goes
// to its place through `guidance.onGo`.
export function AskPanel({
  ask,
  unavailable,
  current,
  onCite,
  autoFocus = false,
  locate,
  onShowPassage,
  drafting,
  guidance,
}: {
  ask: AskWorkflow | null
  unavailable?: string
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  autoFocus?: boolean
  locate?: (anchor: CommentAnchor) => boolean | undefined
  onShowPassage?: (passage: AskPassage) => void
  drafting?: AskDrafting
  guidance?: AskGuidanceTarget
}) {
  const [question, setQuestion] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // The conversation whose delete is being confirmed (AS-03 AC2).
  const [deleting, setDeleting] = useState<AskConversation | null>(null)
  const thread = useRef<HTMLOListElement>(null)
  // Holds the question box, to focus it: the shared Textarea takes no ref.
  const box = useRef<HTMLDivElement>(null)
  const focusBox = () => box.current?.querySelector('textarea')?.focus()
  const count = ask?.items.length ?? 0
  const last = ask?.items.at(-1)
  const progress = `${count}:${last?.statements.length ?? 0}:${last?.missing.length ?? 0}:${last?.status}`
  // The question box, sticky at the foot of the panel.
  const composer = useRef<HTMLFormElement>(null)
  // Keeps the newest answer in view as it is written. The margin is the sticky
  // question box's height: without it "nearest" parks the answer's end (a
  // stopped answer's Ask again, a card's Insert) behind the box.
  useEffect(() => {
    const item = thread.current?.lastElementChild as HTMLElement | null | undefined
    if (!item) return
    item.style.scrollMarginBottom = `${composer.current?.offsetHeight ?? 0}px`
    item.scrollIntoView?.({ block: 'nearest' })
  }, [progress])
  useEffect(() => {
    if (autoFocus) box.current?.querySelector('textarea')?.focus()
  }, [autoFocus])
  // A passage chosen with Ask about this: the question box is next (AS-02).
  const about = ask?.about ?? null
  useEffect(() => {
    if (about) box.current?.querySelector('textarea')?.focus()
  }, [about])
  // The Ask walkthrough's step 2 (F-12) says it has typed a question in: fill the box when that step
  // shows, only if it is empty. Without the empty check it would overwrite what the person typed.
  const walking = useWalkthroughs((s) => s.running)
  const walkStep = walking?.id === 'ask' ? walking.at : 0
  const [seenWalkStep, setSeenWalkStep] = useState(0)
  if (walkStep !== seenWalkStep) {
    setSeenWalkStep(walkStep)
    if (walkStep === 2) setQuestion((q) => q || WALK_QUESTION)
  }

  if (!ask || ask.state === 'unavailable')
    return (
      <div className="ask-panel">
        <EmptyState
          icon="message-circle-question"
          title="Ask is unavailable"
          description={
            unavailable ?? ask?.reason ?? "This assessment isn't saved, so it can't be asked about."
          }
        />
      </div>
    )

  // A passage chosen with Rewrite this (AS-04), rewritten by the next request.
  const rewriting = !!about && ask.rewriting && !!drafting
  // Asks a question, about `passage` when given: the one in the question box
  // unless asked again.
  const send = (text: string, passage: AskPassage | null = about) => {
    if (ask.switching || ask.archived) return
    if (rewriting && passage === about) {
      draft('rewrite')
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      setProblem('Type a question to ask.')
      focusBox()
      return
    }
    if (trimmed.length > MAX_QUESTION) {
      setProblem('Keep the question to 1,000 characters.')
      return
    }
    setProblem(null)
    setQuestion('')
    if (passage && passage === about) ask.setAbout(null)
    void ask.ask(trimmed, passage)
  }
  // Asks for text instead of an answer (AS-04): new text for the open section
  // from the request typed, or a rewrite of the passage in the box (the
  // request then says how, and may be left empty).
  const draft = (kind: 'draft' | 'rewrite') => {
    if (ask.switching || ask.archived || !drafting) return
    const trimmed = question.trim() || (kind === 'rewrite' ? 'Rewrite this passage.' : '')
    if (!trimmed) {
      setProblem('Say what to draft, e.g. a paragraph on flood exposure from the observations.')
      focusBox()
      return
    }
    if (trimmed.length > MAX_QUESTION) {
      setProblem('Keep the request to 1,000 characters.')
      return
    }
    if (kind === 'draft' && !drafting.target) return
    setProblem(null)
    setQuestion('')
    if (kind === 'rewrite') {
      const passage = about
      ask.setAbout(null)
      void ask.ask(trimmed, passage, { kind: 'rewrite' })
    } else void ask.ask(trimmed, null, { kind: 'draft', sectionId: drafting.target!.sectionId })
  }
  // Why Draft text can't be used now.
  const draftBlocked: Reason | undefined = !drafting?.target
    ? {
        title: 'No section open',
        text: 'Open one of Sections 4 to 12 to draft text into it.',
      }
    : about
      ? {
          title: 'A passage is in the box',
          text: 'Remove it to draft new text, or ask about it.',
        }
      : undefined
  // Writing guidance for the part open (AS-08).
  const askGuide = (kind: GuideKind, section = guidance?.target ?? null) => {
    if (ask.switching || ask.archived || ask.busy || !section) return
    if (guideBlocked(kind, section)) return
    setProblem(null)
    void ask.guide(kind, section)
  }
  const guideReason = (kind: GuideKind): Reason | undefined =>
    ask.busy ? ANSWERING_NOW : guideBlocked(kind, guidance?.target ?? null)
  // A citation of the template's part goes to its place in the section (AS-08);
  // any other opens its source.
  const cite = (ref: string, item: AskItem) => {
    if (ref.startsWith('T:') && guidance)
      guidance.onGo(
        templateLink(
          ref,
          item.template?.find((t) => t.id === ref),
        ),
      )
    else onCite(ref, item)
  }
  const passageOf = (item: AskItem) =>
    item.passage && (
      <PassageQuote
        passage={item.passage}
        heading={item.passage.label}
        found={locate?.(item.passage.anchor)}
        onShow={onShowPassage && (() => onShowPassage(item.passage!))}
      />
    )

  return (
    <div className="ask-panel">
      <ConversationBar ask={ask} onDelete={() => setDeleting(ask.conversation)} />
      {ask.problem && (
        <div role="alert">
          <Callout tone="warning" title="Conversation not opened">
            {ask.problem}
          </Callout>
        </div>
      )}
      <div className="ask-intro">
        <div className="ask-scope">
          <p className="rv-muted" data-walk="ask.scope">
            {scopeLine(ask)}
          </p>
          <Tip id="ask.searches" />
        </div>
      </div>
      {ask.state === 'loading' ? (
        <p className="rv-muted">Loading earlier questions…</p>
      ) : ask.switching ? (
        <p className="rv-muted" role="status">
          Opening the conversation…
        </p>
      ) : count === 0 ? (
        <p className="rv-muted ask-empty">
          Answers cite the observations, standards and past reports they rest on, and say what
          evidence is missing when there is none.
        </p>
      ) : (
        <ol ref={thread} className="ask-thread" aria-label="Questions and answers">
          {ask.items.map((item, i) => (
            <li key={item.key} className="ask-item">
              <div className="ask-question">
                {passageOf(item)}
                <p className="ask-question-text">
                  <span className="ask-sr-only">Question: </span>
                  {item.question}
                </p>
              </div>
              {item.requested ? (
                <ProposalCard
                  item={item}
                  ask={ask}
                  drafting={drafting}
                  current={current}
                  onCite={onCite}
                />
              ) : item.guidance?.kind === 'missing' ? (
                <GapList
                  item={item}
                  onGo={guidance?.onGo}
                  onAskAgain={() => askGuide('missing', item.guidance)}
                  canAsk={!ask.busy && !ask.archived}
                />
              ) : (
                <Answer
                  item={item}
                  current={current}
                  onCite={cite}
                  onAskAgain={(text, passage) =>
                    item.guidance
                      ? askGuide(item.guidance.kind, item.guidance)
                      : send(text, passage)
                  }
                  canAsk={!ask.busy && !ask.archived}
                  walk={i === count - 1 ? 'ask.answer' : undefined}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {ask.archived ? (
        // Read only (AS-03 AC5): the gateway refuses new questions too (409).
        <p className="ask-readonly" role="note">
          <Icon name="archive" size={14} color="var(--text-muted)" />
          <span>
            This assessment is archived, so its conversations are read only. Restore the assessment
            to ask about it again.
          </span>
        </p>
      ) : (
        <>
          {guidance && (
            // Writing guidance for the part open (AS-08): two questions asked
            // by button, never guessed from what is typed.
            <div className="ask-guide" role="group" aria-label="Writing guidance">
              <p className="ask-guide-for">
                <span className="rv-label">Writing guidance</span>
                <span className="ask-guide-section">
                  {guidance.target?.label ?? 'No section open'}
                </span>
              </p>
              <div className="ask-guide-buttons">
                <Button
                  pill
                  variant="secondary"
                  size="sm"
                  iconLeft="list-checks"
                  disabled={ask.switching}
                  disabledReason={guideReason('cover')}
                  onClick={() => askGuide('cover')}
                >
                  What should this section cover?
                </Button>
                <Button
                  pill
                  variant="secondary"
                  size="sm"
                  iconLeft="list-x"
                  disabled={ask.switching}
                  disabledReason={guideReason('missing')}
                  onClick={() => askGuide('missing')}
                >
                  What is missing from this section?
                </Button>
              </div>
            </div>
          )}
          <form
            ref={composer}
            className="ask-composer"
            aria-label="Ask a question"
            data-walk="ask.composer"
            onSubmit={(event) => {
              event.preventDefault()
              send(question)
            }}
          >
            {about && (
              <PassageQuote
                passage={about}
                heading={`${rewriting ? 'Rewriting' : 'Asking about'} ${about.label}`}
                onRemove={() => {
                  ask.setAbout(null)
                  focusBox()
                }}
              />
            )}
            <div ref={box}>
              <Textarea
                label={rewriting ? 'How to rewrite it' : 'Question'}
                name="question"
                rows={3}
                value={question}
                maxLength={MAX_QUESTION}
                placeholder={
                  rewriting
                    ? 'e.g. Make it more concise, keeping its citations (optional)'
                    : about
                      ? 'e.g. Where does this figure come from?'
                      : drafting
                        ? 'e.g. Which observations concern the valves? Or: Draft a paragraph on flood exposure'
                        : 'e.g. Which observations concern the sprinkler control valves?'
                }
                error={problem ?? undefined}
                onChange={(event) => {
                  setQuestion(event.target.value)
                  if (problem) setProblem(null)
                }}
                onKeyDown={(event) => {
                  // Enter asks; Shift+Enter starts a new line.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (!ask.busy) send(question)
                  }
                }}
              />
            </div>
            <div className="ask-composer-actions">
              {!ask.busy && (
                <DictateButton
                  reference={ask.reference}
                  field={() => box.current?.querySelector('textarea')}
                  onChange={(text) => {
                    setQuestion(text)
                    if (problem) setProblem(null)
                  }}
                />
              )}
              <span className="rv-muted ask-hint">
                {rewriting
                  ? 'Enter to rewrite, Shift+Enter for a new line'
                  : 'Enter to ask, Shift+Enter for a new line'}
              </span>
              {ask.busy ? (
                <Button
                  pill
                  type="button"
                  variant="secondary"
                  size="sm"
                  iconLeft="square"
                  onClick={ask.stop}
                >
                  Stop
                </Button>
              ) : rewriting ? (
                <Button
                  pill
                  type="submit"
                  variant="primary"
                  size="sm"
                  iconLeft="sparkles"
                  disabled={ask.switching}
                >
                  Rewrite
                </Button>
              ) : (
                <>
                  {drafting && (
                    <>
                      <Tip id="ask.draft-text" align="right" />
                      <Button
                        pill
                        type="button"
                        variant="secondary"
                        size="sm"
                        iconLeft="pen-line"
                        disabled={ask.switching}
                        disabledReason={draftBlocked}
                        data-walk="ask.draft-text"
                        onClick={() => draft('draft')}
                      >
                        Draft text
                      </Button>
                    </>
                  )}
                  <Button
                    pill
                    type="submit"
                    variant="primary"
                    size="sm"
                    iconLeft="sparkles"
                    disabled={ask.switching}
                  >
                    Ask
                  </Button>
                </>
              )}
            </div>
          </form>
        </>
      )}
      {deleting && (
        <DeleteConversationDialog
          conversation={deleting}
          questions={deleting.id === ask.conversation?.id ? count : deleting.questions}
          onDelete={async () => {
            await ask.remove(deleting.id)
            setDeleting(null)
            toast.success('Conversation deleted')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
