// The assessment's Overview as a conversation with MarshBot (AS-06 boards 01 to 07 and 11):
// MarshBot, the stages and the client card on the left (a stage bar on a phone), and on the
// right its earlier exchanges, then what it says now, one message at a time.
// Called by assessments/screens/Overview.tsx. Calls useBrief.ts and usePacing.ts.
import { useMemo, useState } from 'react'
import { Button, useIsPhone } from '../../../design-system'
import { retryPageTranscription, retryTranscription } from '../../assessments/api'
import { ClientCard } from '../components/ClientCard'
import { EngineerReply } from '../components/EngineerReply'
import { MarshBotFace } from '../components/MarshBotFace'
import { MessageBody } from '../components/MessageBody'
import { MessageBubble } from '../components/MessageBubble'
import { PhoneStageBar } from '../components/PhoneStageBar'
import { StageRail } from '../components/StageRail'
import { TypingDots } from '../components/TypingDots'
import { MarshBotContext, type MarshBot } from '../context'
import { saidAt, visitDay } from '../format'
import { planOf } from '../plan'
import { STAGES, type AssistantBrief, type BriefItem, type ItemLink, type Stage } from '../types'
import { useBrief } from '../useBrief'
import { usePacing } from '../usePacing'
import '../marshbot.css'

type Props = {
  reference: string
  openLink: (link: ItemLink) => void
  openDetails: () => void
}

// A row's in-place action: retry a failed recording or handwritten page.
async function act(item: BriefItem) {
  const [observation, target] = (item.actionTarget ?? '').split(':')
  if (item.action === 'retry-transcription') await retryTranscription(observation, target)
  if (item.action === 'retry-page') await retryPageTranscription(observation, target)
}

/** Returns the MarshBot Overview for a saved assessment. */

// The server's closing "all caught up" message (id `done-…`, server/src/services/assistant/messages.ts)
// shows as one quiet line after the rest, never as a bubble or a paced message.
const isDone = (m: { id: string }) => m.id.startsWith('done-')
export function MarshBotOverview({ reference, openLink, openDetails }: Props) {
  const state = useBrief(reference)
  if (state.failed)
    return (
      <div className="mb-failed" role="alert">
        <p>MarshBot couldn’t load this assessment.</p>
        <Button variant="secondary" pill onClick={state.retry}>
          Try again
        </Button>
      </div>
    )
  if (!state.brief) return <div className="mb" aria-busy="true" />
  return (
    <Conversation {...state} brief={state.brief} openLink={openLink} openDetails={openDetails} />
  )
}

// The stage the rail showed at the viewer's last open, so a move since then animates (board 12).
function stageAtLastOpen(brief: AssistantBrief, lastOpened: string | null): Stage | undefined {
  if (!lastOpened) return undefined
  const entered = brief.stageDates[brief.stage]
  const i = STAGES.indexOf(brief.stage)
  return entered && entered > lastOpened && i > 0 ? STAGES[i - 1] : undefined
}

function Conversation({
  brief,
  ticked,
  firstLastOpened,
  reply,
  dismiss,
  openLink,
  openDetails,
}: ReturnType<typeof useBrief> & { brief: AssistantBrief } & Omit<Props, 'reference'>) {
  const phone = useIsPhone()
  // a. Pace the messages only when something changed since the viewer's last open.
  const [paced] = useState(() => !firstLastOpened || brief.updatedAt > firstLastOpened)
  const [from] = useState(() => stageAtLastOpen(brief, firstLastOpened))
  const planned = useMemo(
    () => brief.messages.filter((m) => !isDone(m)).map((m) => ({ id: m.id, plan: planOf(m) })),
    [brief],
  )
  const pacing = usePacing(planned, paced)
  // b. A pressed quick reply shows as the engineer's bubble while it is sent.
  const [answering, setAnswering] = useState<{ id: string; text: string; at: string } | null>(null)
  const bot: MarshBot = {
    brief,
    ticked,
    openLink,
    dismiss,
    act,
    answering: answering?.id ?? null,
    answer: (id, r, date) => {
      // One reply at a time: without this, a second press would post the reply twice.
      if (answering) return
      setAnswering({
        id,
        text: date ? `${r.label} on ${visitDay(date)}` : r.label,
        at: new Date().toISOString(),
      })
      void reply(r, date).then(() => setAnswering(null))
    },
  }
  const admin = brief.viewer === 'admin'
  const shown = brief.messages.filter((m) => !isDone(m) && pacing.cursorOf(m.id) !== 'none')
  const done = brief.messages.find(isDone)
  // The last message said in full, for screen readers: one announcement per finished message,
  // never each word as it streams in.
  const finished = shown.filter((m) => pacing.cursorOf(m.id) === 'all').at(-1)
  return (
    <MarshBotContext.Provider value={bot}>
      <div className="mb" data-admin={admin || undefined}>
        {phone ? (
          <PhoneStageBar brief={brief} onOpen={openDetails} />
        ) : (
          <aside className="mb-rail" aria-label="MarshBot and stages">
            <div className="mb-bot">
              <span className="mb-face">
                <MarshBotFace mood={brief.mood} />
              </span>
              <div>
                <b>MarshBot</b>
                {admin && brief.engineerName && (
                  <small>{`${brief.engineerName}’s assessment`}</small>
                )}
              </div>
            </div>
            <StageRail brief={brief} from={from} />
            <ClientCard
              name={brief.client.name}
              reference={brief.client.reference}
              onOpen={openDetails}
            />
          </aside>
        )}
        <section className="mb-convo" aria-label="MarshBot" tabIndex={-1}>
          <p className="mb-sr" aria-live="polite">
            {finished?.text}
          </p>
          <div className="mb-thread">
            {/* c. Earlier exchanges, oldest first, all at once. */}
            {brief.thread.map((t, i) =>
              t.who === 'engineer' ? (
                <EngineerReply key={i} text={t.text} said={saidAt(t.at)} />
              ) : (
                // An answered question is a plain message now: only an open one is tinted blue.
                <MessageBubble
                  key={i}
                  said={saidAt(t.at)}
                  tone={t.tone === 'question' ? 'normal' : t.tone}
                >
                  <p className="mb-say">{t.text}</p>
                </MessageBubble>
              ),
            )}
            {/* d. What MarshBot says now, as far as the reveal has got. */}
            {shown.map((m, i) => (
              <div key={m.id} className="mb-turn">
                <MessageBubble
                  said={i === 0 ? saidAt(brief.updatedAt) : undefined}
                  tone={answering?.id === m.id && m.tone === 'question' ? 'normal' : m.tone}
                  big={i === 0 && !brief.thread.length}
                  aside={
                    i === 0 && pacing.waiting ? (
                      <button type="button" className="mb-seeall mb-hit" onClick={pacing.showAll}>
                        Show all
                      </button>
                    ) : undefined
                  }
                >
                  <MessageBody message={m} cursor={pacing.cursorOf(m.id)} />
                </MessageBubble>
                {answering?.id === m.id && (
                  <EngineerReply text={answering.text} said={saidAt(answering.at)} />
                )}
              </div>
            ))}
            {pacing.typing && <TypingDots />}
            {/* e. Once everything is said: the coverage check still running, or all caught up. */}
            {!pacing.waiting && brief.coverage.status === 'running' && (
              <TypingDots label="Checking what your observations cover" />
            )}
            {!pacing.waiting && done && (
              <p className="mb-done">
                <span className="mb-done-tick" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="mb-tick">
                    <circle cx="12" cy="12" r="11" />
                    <path d="M7 12.5l3.2 3.2L17 9" />
                  </svg>
                </span>
                {done.text}
              </p>
            )}
          </div>
        </section>
      </div>
    </MarshBotContext.Provider>
  )
}
