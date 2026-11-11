import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  ConfidenceIndicator,
  EmptyState,
  EvidenceCitation,
  Icon,
  Textarea,
} from '../../../design-system'
import type { FieldObservation, SourcePassage } from '../api'
import { CitationMark } from '../components/CitationMark'
import { formatTimeOfDay } from '../format'
import { excerpt, pageLocator, severityLabel } from '../reviewDisplay'
import type { AskCitation } from './api'
import type { AskItem, AskWorkflow } from './useAsk'
import './ask.css'

const MAX_QUESTION = 1000

const KIND_LABEL: Record<AskCitation['kind'], string> = {
  observation: 'Site observation',
  standard: 'External standard',
  report: 'Past report',
}

// A cited source of an answer, as the evidence panel opens it.
type AskSource =
  | { ref: string; kind: 'observation'; observation: FieldObservation }
  | { ref: string; kind: 'standard' | 'report'; passage: SourcePassage }

/** An answer's cited sources by citation ID, once its result has arrived. */
function sourcesOf(item: AskItem): Map<string, AskSource> {
  const found = new Map<string, AskSource>()
  for (const p of item.passages)
    found.set(p.id, { ref: p.id, kind: p.kind === 'precedent' ? 'report' : 'standard', passage: p })
  for (const o of item.observations)
    found.set(`O:${o.id}`, { ref: `O:${o.id}`, kind: 'observation', observation: o })
  return found
}

// The answer's sources in the order its statements first cite them, numbered from 1.
function citedOrder(item: AskItem): AskCitation[] {
  const seen = new Map<string, AskCitation>()
  for (const s of item.statements)
    for (const c of s.citations) {
      const known = seen.get(c.ref)
      // A source is unverified if any of its quotes was not found in it.
      if (!known) seen.set(c.ref, c)
      else if (!c.verified) seen.set(c.ref, { ...known, verified: false })
    }
  return [...seen.values()]
}

function sourceName(source: AskSource | undefined, citation: AskCitation): string {
  if (!source) return KIND_LABEL[citation.kind]
  if (source.kind === 'observation') return source.observation.location ?? 'Location not recorded'
  return source.passage.document?.title ?? source.passage.documentId ?? 'Document not found'
}

const STEP_TEXT = {
  retrieve: 'Searching the observations, selected standards and past reports…',
  generate: 'Writing the answer…',
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
}: {
  item: AskItem
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  onAskAgain: (question: string) => void
  canAsk: boolean
}) {
  const answering = item.status === 'answering'
  const order = citedOrder(item)
  const number = new Map(order.map((c, n) => [c.ref, n + 1]))
  const sources = sourcesOf(item)
  const failedAt = item.failure ? formatTimeOfDay(new Date(item.failure.at)) : null
  return (
    <article
      className="ask-answer"
      aria-label={`Answer to: ${item.question}`}
      aria-busy={answering || undefined}
    >
      <div className="ask-answer-head">
        <Icon name="sparkles" size={14} color="var(--ai-fg)" />
        <span className="ask-answer-title">Answer</span>
        <span />
        {item.confidence && <ConfidenceIndicator level={item.confidence} />}
      </div>
      {answering && item.step && (
        <p className="ask-step" role="status">
          <span className="ask-dot" aria-hidden="true" />
          {STEP_TEXT[item.step]}
        </p>
      )}
      {item.statements.length > 0 && (
        <div className="ask-statements">
          {item.statements.map((s, i) => (
            <p key={i} className="ask-statement">
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
        <div role="alert">
          <Callout
            tone="danger"
            title="The answer stopped"
            actions={
              canAsk ? (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="rotate-ccw"
                  onClick={() => onAskAgain(item.question)}
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
        <section className="ask-sources" aria-label="Sources">
          <h4 className="rv-label">Sources</h4>
          <ul className="rv-panel-list">
            {order.map((c) => {
              const source = sources.get(c.ref)
              const passage = source && source.kind !== 'observation' ? source.passage : null
              const observation = source?.kind === 'observation' ? source.observation : null
              return (
                <li key={c.ref}>
                  <EvidenceCitation
                    index={number.get(c.ref)}
                    kind={c.kind}
                    source={
                      <>
                        {sourceName(source, c)}
                        {!c.verified && (
                          <span className="rv-flag">
                            <Badge tone="moderate" icon="triangle-alert">
                              Quote not found
                            </Badge>
                          </span>
                        )}
                      </>
                    }
                    locator={
                      passage
                        ? (pageLocator(passage) ?? undefined)
                        : observation
                          ? severityLabel(observation.severity || 'not set')
                          : undefined
                    }
                    excerpt={
                      c.quote
                        ? `“${c.quote}”`
                        : passage
                          ? excerpt(passage.text)
                          : observation?.note
                            ? excerpt(observation.note)
                            : undefined
                    }
                    onOpen={() => onCite(c.ref, item)}
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
      )}
    </article>
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
// their cited answers, newest last, then the question box. Without the
// gateway (`ask` null, e.g. the sample assessment) it says it is unavailable
// and why (AC7).
export function AskPanel({
  ask,
  unavailable,
  current,
  onCite,
  autoFocus = false,
}: {
  ask: AskWorkflow | null
  unavailable?: string
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  autoFocus?: boolean
}) {
  const [question, setQuestion] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const thread = useRef<HTMLOListElement>(null)
  // Holds the question box, to focus it: the shared Textarea takes no ref.
  const box = useRef<HTMLDivElement>(null)
  const focusBox = () => box.current?.querySelector('textarea')?.focus()
  const count = ask?.items.length ?? 0
  const last = ask?.items.at(-1)
  const progress = `${count}:${last?.statements.length ?? 0}:${last?.missing.length ?? 0}:${last?.status}`
  // Keeps the newest answer in view as it is written.
  useEffect(() => {
    const list = thread.current
    list?.lastElementChild?.scrollIntoView?.({ block: 'nearest' })
  }, [progress])
  useEffect(() => {
    if (autoFocus) box.current?.querySelector('textarea')?.focus()
  }, [autoFocus])

  if (!ask || ask.state === 'unavailable')
    return (
      <div className="ask-panel">
        <EmptyState
          icon="message-circle-question"
          title="Ask is unavailable"
          description={
            unavailable ??
            ask?.reason ??
            'Answers are searched through the gateway, which this view cannot reach.'
          }
        />
      </div>
    )

  const send = (text: string) => {
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
    void ask.ask(trimmed)
  }

  return (
    <div className="ask-panel">
      <div className="ask-intro">
        <h3 className="rv-label">Ask about this assessment</h3>
        <p className="rv-muted">{scopeLine(ask)}</p>
      </div>
      {ask.state === 'loading' ? (
        <p className="rv-muted">Loading earlier questions…</p>
      ) : count === 0 ? (
        <p className="rv-muted ask-empty">
          Answers cite the observations, standards and past reports they rest on, and say what
          evidence is missing when there is none.
        </p>
      ) : (
        <ol ref={thread} className="ask-thread" aria-label="Questions and answers">
          {ask.items.map((item) => (
            <li key={item.key} className="ask-item">
              <p className="ask-question">
                <span className="ask-sr-only">Question: </span>
                {item.question}
              </p>
              <Answer
                item={item}
                current={current}
                onCite={onCite}
                onAskAgain={send}
                canAsk={!ask.busy}
              />
            </li>
          ))}
        </ol>
      )}
      <form
        className="ask-composer"
        aria-label="Ask a question"
        onSubmit={(event) => {
          event.preventDefault()
          send(question)
        }}
      >
        <div ref={box}>
          <Textarea
            label="Question"
            name="question"
            rows={3}
            value={question}
            maxLength={MAX_QUESTION}
            placeholder="e.g. Which observations concern the sprinkler control valves?"
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
          <span className="rv-muted ask-hint">Enter to ask, Shift+Enter for a new line</span>
          {ask.busy ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft="square"
              onClick={ask.stop}
            >
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="sm" iconLeft="sparkles">
              Ask
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
