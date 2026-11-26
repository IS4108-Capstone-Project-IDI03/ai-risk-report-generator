// Text drafted or rewritten for a section (AS-04) as a MarshBot turn: one bubble titled
// "Proposed text · 9. Fire Protection" with a rewrite's paragraphs before, then the text in the
// report's serif, each sentence with its citation numbers and any with no supporting source
// marked Unsupported (AC3). Under the bubble: Insert into and Insert (or Replace), and once in,
// what happened with Undo; a refusal says why (AC6). The section changes only through
// text-proposal.service.ts (ask.apply). Drawn by AskPanel.tsx.
import { useState } from 'react'
import { Badge, BotTurn, Button, Icon, Select, SpeechBubble } from '../../../../design-system'
import { CitationMark } from '../../components/CitationMark'
import { formatTimeOfDay } from '../../format'
import type { AskStatement, Proposal } from '../api'
import { citationsOf } from '../sources'
import { STOPPED, type AskItem, type AskWorkflow } from '../useAsk'
import type { AskDrafting } from '../AskPanel'
import { EvidenceMissing } from './EvidenceMissing'
import { SourceList } from './SourceList'
import { TurnProblem } from './TurnProblem'
import { TurnTyping } from './TurnTyping'

// For proposed text (AS-04), which searches no past report.
const DRAFT_STEP_TEXT = {
  retrieve: 'Searching the observations and the standards in the drafting set…',
  generate: 'Writing the text…',
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

/** Returns the proposed-text turn; Insert, Replace and Undo are offered only with `drafting` (AC5). */
export function ProposalTurn({
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
  const { order, number, sources, label: citeLabel } = citationsOf(item)
  const paragraphs = [...new Set(sentences.map((s) => s.paragraph))].sort((a, b) => a - b)
  const unsupported = sentences.filter((s) => !s.supported).length
  const choices = proposal?.choices ?? []
  const [into, setInto] = useState<number | null>(null)
  const chosen = into ?? proposal?.subsection ?? choices[0]?.index ?? -1
  const busy = ask.applying === item.key
  const stopped = item.failure?.cause === STOPPED
  const apply = async (action: 'insert' | 'replace' | 'undo') => {
    const done = await ask.apply(item, action, action === 'insert' ? chosen : undefined)
    if (done && drafting) drafting.onApplied(done.workspace, done.proposal, item)
  }
  const redraft =
    drafting && !ask.busy && !ask.archived
      ? { label: 'Draft again', icon: 'refresh-cw', onClick: () => ask.redraft(item) }
      : undefined
  const settled = proposal && settledLine(proposal, label)
  const said = sentences.length > 0 || item.missing.length > 0
  return (
    <article
      className="ask-turn"
      aria-label={`${kind === 'draft' ? 'Proposed text' : 'Proposed rewrite'}: ${item.question}`}
      aria-busy={answering || undefined}
    >
      <BotTurn
        mood={answering ? 'thinking' : item.failure && !stopped ? 'concerned' : 'idle'}
        named
      >
        {said && (
          <SpeechBubble tone="normal" tail>
            <p className="ask-turn-title">
              {kind === 'draft' ? 'Proposed text' : 'Proposed rewrite'} · {label}
            </p>
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
                              label={citeLabel(c)}
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
                source. Inserted, {unsupported === 1 ? 'it stays' : 'they stay'} marked Unsupported
                and the report can't be exported until each is given a citation or deleted.
              </p>
            )}
            <EvidenceMissing missing={item.missing} />
          </SpeechBubble>
        )}
        {answering && <TurnTyping label={item.step ? DRAFT_STEP_TEXT[item.step] : undefined} />}
        {item.failure && (
          <TurnProblem
            calm={stopped}
            tail={!said}
            title={stopped ? 'You stopped this text' : 'The text stopped'}
            again={redraft}
          >
            Text stopped at {formatTimeOfDay(new Date(item.failure.at))}: {item.failure.cause}.{' '}
            {item.failure.next}
          </TurnProblem>
        )}
        {item.refusal && (
          <TurnProblem
            tail={!said && !item.failure}
            title={item.refusal.stale ? 'The section changed' : 'Not done'}
            again={item.refusal.stale ? redraft : undefined}
          >
            Refused at {formatTimeOfDay(new Date(item.refusal.at))}: {item.refusal.cause}.{' '}
            {item.refusal.next}
          </TurnProblem>
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
              <span className="ask-proposal-where">At the end of {choices[0].heading}</span>
            )}
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
          <div className="ask-proposal-status" role="status">
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
      </BotTurn>
    </article>
  )
}
