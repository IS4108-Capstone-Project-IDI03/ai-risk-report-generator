// The thread engine (AS-06 round 5): given the saved conversation, the brief
// now and what just happened (an open, a change, a reply), returns the turns
// MarshBot adds and the conversation after them. Pure: no database, no clock,
// so the same input always gives the same turns and a repeat adds nothing.
// Called by thread.service.ts (which saves) and the tests.
import type { StoredSession, StoredTurn } from '../../../models/assistant-thread.model'
import { dayOf } from '../dates'
import { ASSISTANT } from '../settings'
import type { Card, CardRow, Mood, Reply } from '../types'
import {
  droppedByStageMove,
  needsNewSession,
  newSession,
  programOf,
  topicCtx,
  withIds,
} from './session'
import { ackWords, isTask, liveOf, sorryWords, tasksLeft, todoTopic } from './tasks'
import { coverageFailedTopic } from './topics-capture'
import { DEFS, STAGE_TOPICS } from './topics'
import type { Built, Event, ThreadBrief, ThreadState, ThreadViewer, TopicCtx } from './types'
import { answerWords, greetingSays, moveHint, offer, replyLabel, TOPIC_TITLES } from './words'

export type AdvanceInput = { brief: ThreadBrief; viewer: ThreadViewer; now: Date }

// The first topic still to raise in this stage, without raising it: 'wait'
// while the coverage check it needs is running.
function nextTopic(ctx: TopicCtx): { key: string; built: Built | 'wait' } | null {
  for (const key of STAGE_TOPICS[ctx.brief.stage]) {
    if (ctx.said.includes(key)) continue
    if (key === 'gaps') {
      const status = ctx.brief.coverage.status
      if (status === 'running') return { key, built: 'wait' }
      if (status === 'failed') {
        if (!ctx.said.includes('gaps-failed'))
          return { key: 'gaps-failed', built: coverageFailedTopic() }
        continue
      }
    }
    const built = DEFS[key].build(ctx)
    if (built) return { key, built }
  }
  return null
}

// "Up next: To Tidy Up": the topic "What else?" brings up, by its name on the agenda, so the
// engineer sees how much is left before pressing.
const upNext = (key: string) => TOPIC_TITLES[key] && `Up next: ${TOPIC_TITLES[key]}`

/**
 * Returns the choices offered now: Skip while a tasks topic has open
 * rows, a question's own replies, and "What else?" only when another topic waits.
 * A choice that moves the stage on, and "What else?", carry a `hint` saying what follows.
 */
export function offeredReplies(session: StoredSession | null, ctx: TopicCtx): Reply[] {
  const w = session?.waiting
  // A failed coverage check is said once with nothing to press (P2): the result comes as its own turn.
  if (!w?.turnId || w.topic === 'gaps-failed') return []
  if (w.kind === 'tasks') return tasksLeft(ctx, w.items) ? [offer('skip')] : []
  // A question saved before round 7 may still hold "Not now" and no links: the one is dropped,
  // and its "Export again" opens Export as today's does. Without that, the browser posted it and
  // the stale-export reminder was settled without Export ever opening (review #6).
  if (w.kind === 'question')
    return w.replies
      .filter((r) => r.id !== 'not-now')
      .map((r) =>
        r.id === 'export-again' && !r.link
          ? { ...r, label: 'Export Again', link: { tab: 'export' as const } }
          : { ...r, link: r.link ?? null, hint: moveHint(r.id) },
      )
  const next = nextTopic(ctx)
  return next ? [{ ...offer('what-else'), hint: upNext(next.key) }] : []
}

// A row that is no longer open, as a done row: green with a tick, unless it already ends in Done.
const asDone = (r: CardRow): CardRow =>
  r.end.type === 'tick' || (r.end.type === 'status' && r.end.status === 'done')
    ? r
    : { ...r, tone: 'green', bad: false, end: { type: 'tick' } }

// One stored card brought up to date: its rows as the brief has them now, and a
// row that has gone (fixed) kept in place, ticked. Without this, a fixed row
// vanished and the last open one froze as open (rule 2). A row the stage move dropped
// (`dropped`, item ids) stays as it was: it was never fixed.
function merged(old: Card, live: Card | undefined, dropped: Set<string>): Card {
  if (old.type !== 'rows' && old.type !== 'tasks') return live ?? old
  const now = live?.type === old.type ? live.rows : []
  const rows = [
    ...old.rows.map((r) => now.find((x) => x.id === r.id) ?? (dropped.has(r.id) ? r : asDone(r))),
    ...now.filter((x) => !old.rows.some((r) => r.id === x.id)),
  ]
  return { ...(live?.type === old.type ? live : old), rows } as Card
}

/**
 * Returns the turn with its cards rebuilt from the brief now (rows tick,
 * counts move). The turn keeps the cards it was posted with, so a program's
 * card ids stay valid; its words never change.
 */
export function rebuilt(turn: StoredTurn, ctx: TopicCtx): StoredTurn {
  const topic = turn.who === 'bot' ? DEFS[turn.topic] : undefined
  if (!topic || !turn.cards.length) return turn
  // A card of a topic this stage no longer raises stays as it was when the stage moved on, if the
  // move dropped its items. Without this, `merged` ticks every dropped row as done (the Setup
  // card's "Not set" rows) and an outline rebuilds as all ready (Sections with questions open).
  const dropped = ctx.brief.items.filter((i) => droppedByStageMove(ctx.brief, i))
  if (!STAGE_TOPICS[ctx.brief.stage].includes(turn.topic) && dropped.some(topic.claims)) return turn
  const live = withIds(turn.id, topic.build({ ...ctx, rebuild: true }, turn.items)?.cards ?? [])
  return {
    ...turn,
    cards: turn.cards.map((c) =>
      merged(
        c,
        live.find((l) => l.id === c.id),
        new Set(dropped.map((i) => i.id)),
      ),
    ),
  }
}

/** Returns the conversation after `event` and the turns it added (none when nothing is new). */
export function advance(
  state: ThreadState,
  { brief, viewer, now }: AdvanceInput,
  event: Event,
): ThreadState & { added: StoredTurn[] } {
  let earlier = structuredClone(state.earlier)
  let session = state.session ? structuredClone(state.session) : null
  const added: StoredTurn[] = []
  const at = now.toISOString()
  const ctx = () => topicCtx(brief, viewer, now, session, earlier.length > 0)

  // Adds a turn to the session now.
  const post = (who: StoredTurn['who'], topic: string, mood: Mood, built: Partial<Built> = {}) => {
    const s = session!
    const id = `${s.id}-${s.turns.length + 1}`
    const turn: StoredTurn = {
      id,
      who,
      at,
      topic,
      mood,
      says: built.says ?? [],
      cards: withIds(id, built.cards ?? []),
      program: null,
      ...(built.items ? { items: built.items } : {}),
      ...(built.order ? { order: built.order } : {}),
    }
    if (turn.order) turn.program = programOf(turn)
    s.turns.push(turn)
    added.push(turn)
    return turn
  }
  const say = (
    topic: string,
    text: string,
    good: boolean,
    mood: Mood = good ? 'pleased' : 'idle',
  ) => post('bot', topic, mood, { says: [{ text, tone: good ? 'good' : 'normal' }] })

  // Raises one topic and waits on it. `lead` ("Sure!") opens its first bubble after "What else?".
  const raise = (key: string, built: Built, lead?: string) => {
    const s = session!
    const says =
      lead && built.says.length
        ? [{ ...built.says[0], text: `${lead} ${built.says[0].text}` }, ...built.says.slice(1)]
        : built.says
    const main = post('bot', key, built.mood, { ...built, says })
    // A question asked after the cards is its own bubble, and the one the choices answer.
    const turn = built.after?.length
      ? post('bot', 'question', built.mood, { says: built.after })
      : main
    s.said = [...new Set([...s.said, key, ...(built.items ?? []).map((id) => `item:${id}`)])]
    s.waiting = {
      topic: key,
      turnId: turn.id,
      kind: built.kind,
      items: built.items ?? [],
      replies: built.replies ?? [],
    }
  }
  // Raises the stage's next topic, or waits for the coverage check it needs.
  const raiseNext = (lead?: string) => {
    const next = nextTopic(ctx())
    if (!next) session!.waiting = null
    else if (next.built === 'wait')
      session!.waiting = { topic: next.key, turnId: null, kind: 'info', items: [], replies: [] }
    // "Sure!" doesn't open bad news.
    else raise(next.key, next.built, next.built.mood === 'concerned' ? undefined : lead)
  }

  // a. A new session on an open: a new day, or the stage moved on after a pause.
  if (event.type === 'open' && needsNewSession(session, brief.stage, now)) {
    const last = session
    if (session) earlier = [...earlier, session].slice(-ASSISTANT.keepSessions)
    session = newSession(brief, now)
    const greeting = post('bot', 'greeting', 'idle', { says: greetingSays(ctx(), last) })
    raiseNext()
    greeting.mood = added[1]?.mood ?? 'idle'
  } else if (session) {
    // A reply the day after (an Overview left open overnight) starts today's session, without a greeting.
    if (event.type === 'reply' && dayOf(new Date(session.startedAt)) !== dayOf(now)) {
      // The conversation carries on: what was said and asked comes along.
      const { waiting, said } = session
      earlier = [...earlier, session].slice(-ASSISTANT.keepSessions)
      session = { ...newSession(brief, now), waiting, said }
    }
    // b. The stage moved on under this session: its topics start over (a reply's answer says so).
    if (session.stage !== brief.stage) {
      session.stage = brief.stage
      session.said = session.said.filter((k) => k.startsWith('item:'))
      session.waiting = null
      if (event.type !== 'reply') {
        say(
          'moved',
          `${brief.facts.site} has moved on to the next stage, so here's where it stands now.`,
          false,
        )
        raiseNext()
      }
    }
    if (event.type === 'reply') reply(event.reply, event.date)
    else react()
  }

  // c. What a change (or a second open) brings: new tasks at once, a retry that
  // failed again, finished tasks, a question that no longer stands (or now
  // does), or the coverage check MarshBot was waiting for.
  function react() {
    const s = session!
    const c = ctx()
    const fresh = c.open.filter((i) => isTask(i) && !s.said.includes(`item:${i.id}`))
    if (fresh.length) {
      // A question the new tasks cut off is asked again after them.
      const w = s.waiting
      if (w?.kind === 'question') s.said = s.said.filter((k) => k !== w.topic)
      raise(
        'todo',
        todoTopic(
          c,
          fresh.map((i) => i.id),
          true,
        )!,
      )
      return
    }
    const failedAgain = s.said
      .filter((k) => k.startsWith('item:') && !s.said.includes(`sorry:${k.slice(5)}`))
      .map((k) => liveOf(c, k.slice(5)))
      .flatMap(({ item, state }) =>
        item &&
        state === 'open' &&
        item.facts.status === 'failed' &&
        Number(item.facts.attempts) > 1
          ? [item]
          : [],
      )
    if (failedAgain.length) {
      say('sorry', sorryWords(c, failedAgain), false, 'concerned')
      s.said.push(...failedAgain.map((i) => `sorry:${i.id}`))
    }
    const w = s.waiting
    const live = w?.turnId && w.kind !== 'tasks' ? DEFS[w.topic]?.build(c) : undefined
    if (w?.kind === 'tasks') {
      if (tasksLeft(c, w.items)) return
      say('ack', ackWords(c, w.items), true)
      raiseNext()
    } else if (
      w?.turnId &&
      DEFS[w.topic] &&
      (w.kind === 'question') !== (live?.kind === 'question')
    ) {
      // The pill and the choices follow the turn that waits: a question nothing asks any more
      // (every blocker cleared) gives way to the next topic, and a topic that now has a
      // question (a section edited after the export) is raised again with it.
      s.said = s.said.filter((k) => k !== w.topic)
      raiseNext()
    } else if (w?.topic === 'gaps' && !w.turnId) {
      if (brief.coverage.status !== 'running') raiseNext()
    } else if (
      s.said.includes('gaps-failed') &&
      !s.said.includes('gaps') &&
      (!w || w.topic === 'gaps-failed') &&
      brief.coverage.status !== 'failed' &&
      brief.coverage.status !== 'running'
    ) {
      // The check that failed has now come back: its result is a new turn (C12),
      // or, with nothing to say, the conversation moves on.
      const gaps = DEFS.gaps.build(c)
      if (gaps) raise('gaps', gaps)
      else {
        s.said.push('gaps')
        if (w) raiseNext()
      }
    }
  }

  // d. A reply: the engineer's bubble, MarshBot's answer, then the next topic.
  function reply(id: Reply['id'], date?: string) {
    const s = session!
    const w = s.waiting
    // The skipped tasks still open, by title, for "<title> will stay in To Do"; '' when its
    // item has gone, so it is counted but never printed as an empty name (review #30).
    const left =
      w?.kind === 'tasks'
        ? w.items.flatMap((i) => {
            const live = liveOf(ctx(), i)
            return live.state !== 'done' ? [live.item?.title ?? ''] : []
          })
        : []
    post('engineer', 'reply', 'idle', { says: [{ text: replyLabel(id, date), tone: 'normal' }] })
    s.waiting = null
    if (id === 'what-else') return raiseNext('Sure!')
    if (id === 'generate-anyway') {
      s.said.push('generate-anyway')
      const ready = DEFS.ready.build(ctx())
      return ready ? raise('ready', ready) : raiseNext()
    }
    const answer = answerWords(ctx(), id, date, left)!
    const turn = say('answer', answer.text, answer.good)
    if (id === 'export-again')
      turn.cards = withIds(turn.id, [
        {
          type: 'rows',
          id: 'export',
          title: 'Export',
          note: null,
          rows: [],
          ticks: [],
          cta: { label: 'Open Export', link: { tab: 'export' } },
        },
      ])
    // Another visit is answered in full: nothing more until the visit has passed.
    if (id === 'another-visit') s.said.push('visit-question', 'visit-set', 'all-clear')
    else raiseNext()
  }

  if (!session) return { earlier, session, added }
  // e. The cards of this session as they stand now, kept as the snapshot an earlier session shows.
  const now_ = ctx()
  session.turns = session.turns.map((t) => rebuilt(t, now_))
  session.observations = brief.facts.observations
  return { earlier, session, added }
}
