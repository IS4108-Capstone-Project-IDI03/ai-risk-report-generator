// When MarshBot starts a new session, and what a topic builder reads (AS-06
// round 5). A session is one day of work, or a stage that moved on after a
// pause. Called by advance.ts and view.ts.
import type { StoredSession, StoredTurn } from '../../../models/assistant-thread.model'
import { dayOf } from '../dates'
import { firstName } from '../phrases'
import { ASSISTANT } from '../settings'
import type { Card, Say, Stage } from '../types'
import type { ThreadBrief, ThreadViewer, TopicCtx } from './types'

/**
 * Returns whether an open starts a new session: none yet, a new day, or the
 * stage moved on and the last turn is more than 30 minutes old.
 */
export function needsNewSession(session: StoredSession | null, stage: Stage, now: Date): boolean {
  if (!session) return true
  if (dayOf(new Date(session.startedAt)) !== dayOf(now)) return true
  const last = Date.parse(session.turns.at(-1)?.at ?? session.startedAt)
  return session.stage !== stage && now.getTime() - last > ASSISTANT.sameVisitMs
}

/** Returns an empty session starting now. */
export function newSession(brief: ThreadBrief, now: Date): StoredSession {
  return {
    id: `s${now.getTime()}`,
    startedAt: now.toISOString(),
    stage: brief.stage,
    turns: [],
    said: [],
    waiting: null,
    observations: brief.facts.observations,
  }
}

/** Returns what the topic builders read for this session. */
export function topicCtx(
  brief: ThreadBrief,
  viewer: ThreadViewer,
  now: Date,
  session: StoredSession | null,
  catchUp: boolean,
): TopicCtx {
  return {
    brief,
    facts: brief.facts,
    open: brief.items.filter((i) => !i.resolvedAt),
    first: firstName(viewer.name),
    viewer,
    now,
    today: dayOf(now),
    said: session?.said ?? [],
    catchUp,
  }
}

/** Returns the cards with the turn's id in front of their local ids, so a rebuilt card keeps its id. */
export const withIds = (turnId: string, cards: Card[]): Card[] =>
  cards.map((c) => ({ ...c, id: `${turnId}-${c.id}` }))

/** Returns the turn's says and cards in the order they are drawn (its `order`, else says then cards). */
export function partsOf(
  turn: StoredTurn,
): ({ type: 'say'; say: Say } | { type: 'card'; card: Card })[] {
  const order = turn.order ?? [...turn.says.map(() => 'say'), ...turn.cards.map(() => 'card')]
  let say = 0
  let card = 0
  return order.map((kind) =>
    kind === 'say'
      ? { type: 'say', say: turn.says[say++] }
      : { type: 'card', card: turn.cards[card++] },
  )
}

/**
 * Returns the turn as an OpenUI program in its own words and order. Set on a
 * turn whose words sit between its cards: without it, a turn the wording AI
 * didn't word would draw every bubble before every card (the browser's fallback).
 */
export function programOf(turn: StoredTurn): string {
  const lines = partsOf(turn).map((p, n) =>
    p.type === 'say'
      ? `p${n} = Say(${JSON.stringify(p.say.text)}${p.say.tone === 'good' ? ', "good"' : ''})`
      : `p${n} = Card(${JSON.stringify(p.card.id)})`,
  )
  return [`root = Reply([${lines.map((_, n) => `p${n}`).join(', ')}])`, ...lines].join('\n')
}
