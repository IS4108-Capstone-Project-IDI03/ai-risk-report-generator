// What is missing from a section (AS-08 AC2) as a MarshBot turn: the gateway lists it with no AI
// (section-guidance.service.ts), so the bubble holds only its facts. Those that block the export
// come first, as the Export tab lists them (AC3), then the rest, each a fact (AC4) with Go to
// section or Go to observation. The face is concerned while something blocks the export and
// pleased when nothing is missing. Drawn by AskPanel.tsx.
import { BotTurn, CountPill, SpeechBubble, type BotMood } from '../../../../design-system'
import { formatTimeOfDay } from '../../format'
import type { GapLink, SectionGap } from '../api'
import type { AskItem } from '../useAsk'
import { TurnProblem } from './TurnProblem'
import { TurnTyping } from './TurnTyping'

const goLabel = (link: GapLink) =>
  link.to === 'section'
    ? 'Go to section'
    : link.observationId
      ? 'Go to observation'
      : 'Go to observations'

// One group of gaps under its label and count; a blocking gap's rule is red.
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
      <h4 className="ask-gap-head">
        {title} <CountPill>{gaps.length}</CountPill>
      </h4>
      <ul className="ask-gap-list">
        {gaps.map((gap, i) => (
          <li key={i} className={gap.blocksExport ? 'ask-gap is-blocking' : 'ask-gap'}>
            <span>{gap.fact}</span>
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

/** Returns the gap list turn; `onGo` goes to where a gap is finished. */
export function GapListTurn({
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
  const mood: BotMood = checking
    ? 'thinking'
    : item.failure || blocking.length
      ? 'concerned'
      : gaps.length
        ? 'idle'
        : 'pleased'
  return (
    <article
      className="ask-turn"
      aria-label={`Answer to: ${item.question}`}
      aria-busy={checking || undefined}
    >
      <BotTurn mood={mood} named>
        {checking ? (
          <TurnTyping label={`Checking ${label}…`} />
        ) : item.failure ? (
          <TurnProblem
            tail
            title="The check stopped"
            again={
              canAsk ? { label: 'Check again', icon: 'rotate-ccw', onClick: onAskAgain } : undefined
            }
          >
            Check stopped at {formatTimeOfDay(new Date(item.failure.at))}: {item.failure.cause}.{' '}
            {item.failure.next}
          </TurnProblem>
        ) : (
          <>
            <SpeechBubble tone={gaps.length ? 'normal' : 'good'} tail>
              {gaps.length === 0 ? (
                <p>Nothing is missing from {label}.</p>
              ) : (
                <>
                  <p className="ask-turn-title">Missing from {label}</p>
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
            </SpeechBubble>
            <div className="ask-turn-meta">
              As of {formatTimeOfDay(new Date(item.askedAt))}. Listed from the report as saved, with
              no AI. The Export tab lists the same blockers.
            </div>
          </>
        )}
      </BotTurn>
    </article>
  )
}
