// One Ask answer (AS-01) as a MarshBot turn, like the Overview's and the knowledge chat's: the
// face (thinking while it writes), "MarshBot", then one speech bubble with the checked statements
// and their citation numbers, any "Sources disagree" (AS-02) and "Evidence missing" lines; under
// it the confidence, why it stopped, and the cited sources. Statements arrive only as the gateway
// sends them, each already checked (useAsk.ts); this file only draws them. Drawn by AskPanel.tsx.
import { BotTurn, ConfidenceIndicator, Icon, SpeechBubble } from '../../../../design-system'
import { Tip } from '../../../help/Tip'
import { CitationMark } from '../../components/CitationMark'
import { formatTimeOfDay } from '../../format'
import type { AskPassage } from '../passage'
import { citationsOf } from '../sources'
import { STOPPED, type AskItem } from '../useAsk'
import { EvidenceMissing } from './EvidenceMissing'
import { SourceList } from './SourceList'
import { TurnProblem } from './TurnProblem'
import { TurnTyping } from './TurnTyping'

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

/** Returns the answer turn; selecting a citation or a source opens it through `onCite`. */
export function AnswerTurn({
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
  const { order, number, sources, label } = citationsOf(item)
  const steps = item.guidance?.kind === 'cover' ? COVER_STEP_TEXT : STEP_TEXT
  const stopped = item.failure?.cause === STOPPED
  const said = item.statements.length > 0 || item.missing.length > 0
  return (
    <article
      className="ask-turn"
      aria-label={`Answer to: ${item.question}`}
      aria-busy={answering || undefined}
      data-walk={walk}
    >
      <BotTurn
        mood={answering ? 'thinking' : item.failure && !stopped ? 'concerned' : 'idle'}
        named
      >
        {said && (
          <SpeechBubble tone="normal" tail>
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
                    label={label(c)}
                    current={current === c.ref}
                    onSelect={() => onCite(c.ref, item)}
                  />
                ))}
              </p>
            ))}
            <EvidenceMissing missing={item.missing} />
          </SpeechBubble>
        )}
        {answering && <TurnTyping label={item.step ? steps[item.step] : undefined} />}
        {item.failure && (
          <TurnProblem
            calm={stopped}
            tail={!said}
            title={stopped ? 'You stopped this answer' : 'The answer stopped'}
            again={
              canAsk
                ? {
                    label: 'Ask again',
                    icon: 'rotate-ccw',
                    onClick: () => onAskAgain(item.question, item.passage ?? null),
                  }
                : undefined
            }
          >
            Answer stopped at {formatTimeOfDay(new Date(item.failure.at))}: {item.failure.cause}.{' '}
            {item.failure.next}
          </TurnProblem>
        )}
        {item.confidence && !answering && (
          <div className="ask-turn-meta">
            <ConfidenceIndicator level={item.confidence} />
            <Tip id="ask.confidence" />
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
