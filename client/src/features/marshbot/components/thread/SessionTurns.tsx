// One session of the thread (AS-06 canvas C1 to C13, H2): its day and time, then its turns, with
// the time again wherever a turn came a while after the one before. Earlier sessions are drawn
// greyed and read-only. The live session's newest bot turn ends in the action slot. Drawn by
// Thread.tsx.
import type { ReactNode } from 'react'
import { clock, sessionTime } from '../../format'
import { TurnContext } from '../../context'
import { TURN_GAP_MS } from '../../settings'
import type { Session } from '../../types'
import { BotTurn } from './BotTurn'
import { EngineerBubble } from './EngineerBubble'
import { TurnBody } from './TurnBody'

/** Returns the session's divider and turns; `fresh` names the turns that just arrived, and
    `slot` is drawn under the newest bot turn's last bubble or card. */
export function SessionTurns({
  session,
  past = false,
  fresh,
  slot,
}: {
  session: Session
  past?: boolean
  fresh?: Set<string>
  slot?: ReactNode
}) {
  const newest = session.turns.findLast((t) => t.who === 'bot')
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
            {turn.who === 'engineer' ? (
              <EngineerBubble text={turn.says[0]?.text ?? ''} />
            ) : (
              <BotTurn
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
