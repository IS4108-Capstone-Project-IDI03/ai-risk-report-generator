import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  ConfidenceIndicator,
  EmptyState,
  EvidenceCitation,
  Icon,
  IconButton,
  Textarea,
} from '../../../design-system'
import type { FieldObservation, SourcePassage } from '../api'
import type { CommentAnchor } from '../comments/api'
import { CitationMark } from '../components/CitationMark'
import { formatTimeOfDay } from '../format'
import { excerpt, pageLocator, severityLabel } from '../reviewDisplay'
import type { AskCitation } from './api'
import { quotedWords, type AskPassage } from './passage'
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
  return source.passage.document?.title ?? source.passage.documentId ?? 'Document not found'
}

const STEP_TEXT = {
  retrieve: 'Searching the observations, selected standards and past reports…',
  generate: 'Writing the answer…',
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
}: {
  item: AskItem
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  onAskAgain: (question: string, passage: AskPassage | null) => void
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
// and why (AC7). A question about a passage selected in the draft (AS-02)
// quotes it, in the question box and above the question once asked; `locate`
// says whether its text is still there and `onShowPassage` goes back to it.
export function AskPanel({
  ask,
  unavailable,
  current,
  onCite,
  autoFocus = false,
  locate,
  onShowPassage,
}: {
  ask: AskWorkflow | null
  unavailable?: string
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  autoFocus?: boolean
  locate?: (anchor: CommentAnchor) => boolean | undefined
  onShowPassage?: (passage: AskPassage) => void
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
  // A passage chosen with Ask about this: the question box is next (AS-02).
  const about = ask?.about ?? null
  useEffect(() => {
    if (about) box.current?.querySelector('textarea')?.focus()
  }, [about])

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

  // Asks a question, about `passage` when given: the one in the question box
  // unless asked again.
  const send = (text: string, passage: AskPassage | null = about) => {
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
              <div className="ask-question">
                {passageOf(item)}
                <p className="ask-question-text">
                  <span className="ask-sr-only">Question: </span>
                  {item.question}
                </p>
              </div>
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
        {about && (
          <PassageQuote
            passage={about}
            heading={`Asking about ${about.label}`}
            onRemove={() => {
              ask.setAbout(null)
              focusBox()
            }}
          />
        )}
        <div ref={box}>
          <Textarea
            label="Question"
            name="question"
            rows={3}
            value={question}
            maxLength={MAX_QUESTION}
            placeholder={
              about
                ? 'e.g. Where does this figure come from?'
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
