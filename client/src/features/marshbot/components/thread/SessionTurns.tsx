// One session of the thread (AS-06 canvas C1 to C13, H2): its day and time, then its turns, with
// the time again wherever a turn came a while after the one before. Earlier sessions are drawn
// greyed and read-only. The live session's newest bot turn ends in the action slot. Drawn by
// Thread.tsx.
import { useContext, type ReactNode } from 'react'
import { Icon } from '../../../../design-system'
import { STAGE_LABEL } from '../../../assessments/format'
import { clock, sessionTime, turnAnchor } from '../../format'
import { MarshBotContext, TurnContext } from '../../context'
import { MILESTONE_SLACK_MS, TURN_GAP_MS } from '../../settings'
import { STAGES, type Session, type Stage } from '../../types'
import { BotTurn } from './BotTurn'
import { EngineerBubble } from './EngineerBubble'
import { TurnBody } from './TurnBody'

// A stage the assessment moved on to, marked in the conversation where it happened, so the
// journey is felt in the thread, not only in the rail.
function Milestone({ stage, fresh }: { stage: Stage; fresh: boolean }) {
  return (
    <p className="mbt-milestone" data-fresh={fresh || undefined}>
      <span>
        <Icon name="flag" size={15} />
        Moved on to <b>{STAGE_LABEL[stage]}</b>
      </span>
    </p>
  )
}

/** Returns the session's divider and turns; `fresh` names the turns that just arrived, and
    `slot` is drawn under the newest bot turn's last bubble or card. `since` is the time of the
    session before's last turn (null for the first): stages reached after it are marked. */
export function SessionTurns({
  session,
  past = false,
  fresh,
  slot,
  since = null,
}: {
  session: Session
  past?: boolean
  fresh?: Set<string>
  slot?: ReactNode
  since?: string | null
}) {
  const newest = session.turns.findLast((t) => t.who === 'bot')
  const dates = useContext(MarshBotContext)?.thread.stageDates
  // `since` is the last turn of the session before: a stage reached in that session was marked
  // there (within the slack of its reply), so it is not marked again above today's greeting.
  const from = since ? Date.parse(since) + MILESTONE_SLACK_MS : Date.parse(session.startedAt)
  // Each stage reached since then is marked above MarshBot's turn that came with it: the answer
  // to the reply that moved it (the gateway stamps a reply's turns a moment before the stage's
  // own date, hence the slack), else MarshBot's first turn after the date (work done elsewhere).
  // Without the reply rule, a quick reply put the mark above the greeting.
  const marks = new Map<string, Stage[]>()
  const reached = STAGES.filter((s) => dates?.[s])
  for (const stage of STAGES.slice(1)) {
    const at = Date.parse(dates?.[stage] ?? '')
    if (!(at > from)) continue
    // A stage the same press jumped over shares its date with the next one reached (the admin card
    // calls it Skipped; gateway cards.ts stageSpans), so it gets no mark: it never happened.
    const next = reached[reached.indexOf(stage) + 1]
    if (next && Date.parse(dates![next]!) === at) continue
    const reply = session.turns.findLastIndex(
      (t) => t.who === 'engineer' && Math.abs(Date.parse(t.at) - at) <= MILESTONE_SLACK_MS,
    )
    const turn = session.turns.find(
      (t, i) => t.who === 'bot' && (reply >= 0 ? i > reply : Date.parse(t.at) >= at),
    )
    if (turn) marks.set(turn.id, [...(marks.get(turn.id) ?? []), stage])
  }
  return (
    <div className="mbt-session" data-past={past || undefined}>
      <p className="mbt-divider">{sessionTime(session.startedAt)}</p>
      {session.turns.map((turn, i) => {
        const before = session.turns[i - 1]
        const gap = before && Date.parse(turn.at) - Date.parse(before.at) >= TURN_GAP_MS
        // The first of a run of MarshBot's turns; the ones after it sit under the same face.
        const heads = !before || gap || before.who === 'engineer'
        return (
          <TurnContext.Provider key={turn.id} value={{ turn, past }}>
            {gap && <p className="mbt-divider">{clock(turn.at)}</p>}
            {marks.get(turn.id)?.map((stage) => (
              <Milestone key={stage} stage={stage} fresh={!!fresh?.has(turn.id)} />
            ))}
            {turn.who === 'engineer' ? (
              <EngineerBubble text={turn.says[0]?.text ?? ''} />
            ) : (
              <BotTurn
                id={past ? undefined : turnAnchor(turn.id)}
                mood={turn.mood}
                // The name and face head a run of MarshBot's turns, as in a group chat;
                // the face shows again when its mood changes mid-run (e.g. pleased after a task).
                named={heads}
                faced={heads || before.mood !== turn.mood}
                fresh={fresh?.has(turn.id)}
              >
                <TurnBody turn={turn} />
                {turn === newest && slot}
              </BotTurn>
            )}
          </TurnContext.Provider>
        )
      })}
    </div>
  )
}
