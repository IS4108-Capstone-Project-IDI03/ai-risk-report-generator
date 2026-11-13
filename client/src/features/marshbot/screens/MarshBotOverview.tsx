// The assessment's Overview as a saved conversation with MarshBot (AS-06 canvas C1 to C13, S1 to
// S9, H1, H2, round 7 R7-C1 to C8): MarshBot, the stages, the facts at a glance and the client on
// the left (a stage bar on a phone), the thread on the right, with the action slot under
// MarshBot's newest turn. Called by assessments/screens/Overview.tsx. Calls useThread.ts and
// components/thread/.
import { useState, useSyncExternalStore } from 'react'
import { Button, toast, useIsPhone } from '../../../design-system'
import { retryPageTranscription, retryTranscription } from '../../assessments/api'
import { STAGE_LABEL } from '../../assessments/format'
import { PhoneStageBar } from '../components/PhoneStageBar'
import { Rail } from '../components/Rail'
import { Actions } from '../components/thread/Actions'
import { Thread } from '../components/thread/Thread'
import { MarshBotContext, type MarshBot } from '../context'
import { weekDay } from '../format'
import type { AssistantThread, CardRow, ItemLink, Reply } from '../types'
import { useThread, type ThreadState } from '../useThread'
import '../marshbot.css'
import '../components/thread/thread.css'
import '../components/thread/cards.css'

// A window too short for the rail (below its smallest, about 400 px under the page header) shows
// the phone's stage bar instead. Must match the media query in marshbot.css.
const SHORT_WINDOW = '(max-height: 559px)'

/** Returns whether the window is too short for the rail; false where matchMedia is missing. */
function useShortWindow() {
  return useSyncExternalStore(
    (change) => {
      const mq = window.matchMedia?.(SHORT_WINDOW)
      mq?.addEventListener('change', change)
      return () => mq?.removeEventListener('change', change)
    },
    () => window.matchMedia?.(SHORT_WINDOW).matches ?? false,
  )
}

type Props = {
  reference: string
  openLink: (link: ItemLink) => void
  openDetails: () => void
}

/** Returns the MarshBot Overview for a saved assessment. */
export function MarshBotOverview(props: Props) {
  // Keyed, so another assessment starts from its own cached thread, never this one's.
  return <Loader key={props.reference} {...props} />
}

function Loader({ reference, openLink, openDetails }: Props) {
  const state = useThread(reference)
  if (state.failed)
    return (
      <div className="mb-failed" role="alert">
        <p>MarshBot couldn’t load this assessment.</p>
        <Button variant="secondary" pill onClick={state.retry}>
          Try Again
        </Button>
      </div>
    )
  if (!state.thread) return <div className="mb" aria-busy="true" />
  return (
    <Conversation
      thread={state.thread}
      reply={state.reply}
      openLink={openLink}
      openDetails={openDetails}
    />
  )
}

// What changed after a reply, said once as a short toast: a new survey end, a new stage.
function confirmChange(before: AssistantThread, after: AssistantThread) {
  if (after.surveyEnd && after.surveyEnd !== before.surveyEnd)
    toast.success('Survey end date updated')
  if (after.stage !== before.stage) toast.success(`Moved to ${STAGE_LABEL[after.stage]}`)
}

// The newest bot turn's next step: the first of its cards with one (Open Generation, Open Review).
function newestCta(thread: AssistantThread) {
  const turn = thread.session.turns.findLast((t) => t.who === 'bot')
  return turn?.cards.map((c) => ('cta' in c ? c.cta : null)).find((c) => c) ?? null
}

function Conversation({
  thread,
  reply,
  openLink,
  openDetails,
}: { thread: AssistantThread } & Pick<ThreadState, 'reply'> & Omit<Props, 'reference'>) {
  const phone = useIsPhone()
  const short = useShortWindow()
  // The engineer's reply on its way, shown as their bubble until the answer comes back.
  const [pending, setPending] = useState<string | null>(null)
  // Replies the gateway took: each one moves focus to MarshBot's newest turn (Thread.tsx).
  const [answered, setAnswered] = useState(0)
  const [busy, setBusy] = useState<Set<string>>(() => new Set())

  // a. A choice: one with a link only opens it (nothing is posted, the question stays). Any other
  //    is their bubble at once with the slot gone, then the answer and a toast for what changed.
  const answer = (r: Reply, date?: string) => {
    if (r.link) return openLink(r.link)
    // One reply at a time: without this, a second press would post twice.
    if (pending) return
    setPending(date ? `${r.label} on ${weekDay(date)}` : r.label)
    void reply(r.id, date).then((next) => {
      // Cleared on a refusal too, so no bubble is left behind for a reply that wasn't sent.
      setPending(null)
      if (!next) return
      setAnswered((n) => n + 1)
      confirmChange(thread, next)
    })
  }

  // b. Try again on a failed recording or page: the row's "Transcribing" says it, no toast.
  const retry = (row: CardRow) => {
    const end = row.end
    if (end.type !== 'button' || !end.action) return
    const [observation, target] = (end.actionTarget ?? '').split(':')
    const run = end.action === 'retry-page' ? retryPageTranscription : retryTranscription
    setBusy((b) => new Set(b).add(row.id))
    run(observation, target).catch((error: unknown) => {
      setBusy((b) => new Set([...b].filter((id) => id !== row.id)))
      toast.error(error instanceof Error ? error.message : 'Couldn’t try that again.')
    })
  }

  // c. The action slot: nothing while a reply is sent or MarshBot is still writing.
  const cta = newestCta(thread)
  const actions =
    !pending && !thread.thinking && (cta || thread.replies.length) ? (
      <Actions
        cta={cta}
        replies={thread.replies}
        surveyEnd={thread.surveyEnd ?? thread.surveyStart}
        onReply={answer}
        onOpen={openLink}
      />
    ) : null

  const bot: MarshBot = { thread, openLink, retry, busy }
  return (
    <MarshBotContext.Provider value={bot}>
      <div className="mb" data-admin={thread.viewer === 'admin' || undefined}>
        {phone || short ? (
          <PhoneStageBar thread={thread} onOpen={openDetails} />
        ) : (
          <Rail thread={thread} openDetails={openDetails} />
        )}
        <section className="mbt" aria-label="MarshBot">
          <Thread thread={thread} pending={pending} answered={answered} actions={actions} />
        </section>
      </div>
    </MarshBotContext.Provider>
  )
}
