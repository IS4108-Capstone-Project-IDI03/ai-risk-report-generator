// What MarshBot notices between turns (AS-06 round 9, items C and J): the things it listed that
// were sorted since it last spoke, what is still left, and how the gaps changed since they were
// raised (a coverage check that ran again or failed, or a row the checklist cleared). Pure, like
// the engine. Called by advance.ts.
import type { StoredSession } from '../../../models/assistant-thread.model'
import { shortDay } from '../dates'
import type { BriefItem, Card, Say } from '../types'
import { andList, count, upperFirst } from './cards'
import { droppedByStageMove } from './session'
import { tasksLeft } from './tasks'
import { GAPS_KINDS, gapsHeld, SETUP_DONE_QUESTION, SETUP_KINDS } from './topics-capture'
import { heldWords } from './topics-report'
import { DEFS, STAGE_TOPICS } from './topics'
import type { TopicCtx } from './types'
import { TOPIC_TITLES } from './words'

/**
 * Returns the items sorted this session that MarshBot listed (a task it raised, or an item a topic
 * raised this session speaks for) and hasn't said yet: never one a stage move dropped, the report
 * date, a coverage gap (the re-check turn speaks for those), or one while an open gap or task of
 * the same kind has its title (the other of two recordings from one place). Only the same kind:
 * an unrelated open item naming the place (a Thin gap) held the reaction back until the coverage
 * check cleared it a minute later (round 9, item 16).
 */
export function sortedThisSession(s: StoredSession, c: TopicCtx): BriefItem[] {
  const topics = STAGE_TOPICS[c.brief.stage]
  const claimedBy = (k: string, i: BriefItem) =>
    k === 'rest' ? !topics.some((o) => o !== 'rest' && DEFS[o].claims(i)) : DEFS[k].claims(i)
  const listed = (i: BriefItem) =>
    s.said.includes(`item:${i.id}`) || topics.some((k) => s.said.includes(k) && claimedBy(k, i))
  const stillOpen = (i: BriefItem) =>
    c.open.some(
      (o) =>
        o.kind === i.kind &&
        (o.weight === 'fix_now' || o.weight === 'gap') &&
        o.title.toLowerCase() === i.title.toLowerCase(),
    )
  return c.brief.items.filter(
    (i) =>
      !!i.resolvedAt &&
      i.resolvedAt >= s.startedAt &&
      !s.said.includes(`seen:${i.id}`) &&
      !droppedByStageMove(c.brief, i) &&
      // The checklist read is a reminder, but reading it is the step Prepare waits for (item 8).
      (i.weight === 'fix_now' || i.weight === 'gap' || i.id === 'prepare.checklist-read') &&
      i.kind !== 'report-due' &&
      !GAPS_KINDS(i) &&
      !stillOpen(i) &&
      listed(i),
  )
}

// The verb for a list of things: "is" for one singular thing, else "are" ("client documents are").
const be = (things: string[]) => (things.length === 1 && !/s$/.test(things[0]) ? 'is' : 'are')

/**
 * Returns what is still left for the topic MarshBot waits on, as one sentence, or '': Setup names
 * it, To Do and Gaps count it, Before the Survey counts it or says what happens next, and Review
 * names what holds it.
 */
export function leftWords(w: StoredSession['waiting'], c: TopicCtx): string {
  if (w?.topic === 'setup') {
    const missing = c.open.filter(SETUP_KINDS).map((i) => i.title.toLowerCase())
    return missing.length
      ? `${upperFirst(andList(missing))} ${be(missing)} still to add.`
      : `That's every Setup detail in. ${SETUP_DONE_QUESTION}`
  }
  if (w?.kind === 'tasks') {
    const n = tasksLeft(c, w.items)
    return `${count(n, 'thing')} ${n === 1 ? 'is' : 'are'} still left in To Do.`
  }
  if (w?.topic === 'gaps' && w.turnId) {
    const n = liveGapRows(c).length
    return n ? `${count(n, 'gap')} ${n === 1 ? 'is' : 'are'} still open.` : ''
  }
  if (w?.topic === 'before-survey') {
    const card = DEFS['before-survey'].build(c)?.cards[0]
    const n = card?.type === 'rows' ? card.rows.filter((r) => r.end.type !== 'tick').length : 0
    const day = c.facts.surveyStart ? ` on ${shortDay(c.facts.surveyStart)}` : ''
    // Without this the thread just stopped once the last thing was read (item 8).
    return n
      ? `${count(n, 'thing')} ${n === 1 ? 'is' : 'are'} still to look at before the survey.`
      : `That's everything before the survey${day}. I'll pick this up again on the day.`
  }
  if (w?.topic === 'outline') return heldWords(c, false, true)
  return ''
}

/**
 * Returns the waiting topic's button as a card with no rows (its `cta`, e.g. Open Review), so it
 * stays under a reaction while something is left there: the slot under the newest turn draws only
 * that turn's buttons, and without this "Open Review" vanished (item 9). Empty when nothing is left.
 */
export function ctaCards(w: StoredSession['waiting'], c: TopicCtx, left: string): Card[] {
  if (!w || !left) return []
  const cta = DEFS[w.topic]?.build(c, w.items)?.cards.find((x) => 'cta' in x && x.cta)
  if (!cta || !('cta' in cta) || !cta.cta) return []
  const title = TOPIC_TITLES[w.topic] ?? w.topic
  return [{ type: 'rows', id: 'next', title, note: null, rows: [], ticks: [], cta: cta.cta }]
}

/** Returns "1 comment is resolved" when open comments went down but some are left, else ''. */
export function commentsClause(before: number | null, now: number): string {
  if (before === null || !now || now >= before) return ''
  return `${count(before - now, 'comment')} ${before - now === 1 ? 'is' : 'are'} resolved`
}

// A gaps card's local id ('not-covered', 'thin') from its turn-prefixed id.
const localId = (id: string) => (id.endsWith('-not-covered') ? 'not-covered' : 'thin')

// The rows of the gaps cards as they are now, by card.
function liveGapRows(c: TopicCtx) {
  return (DEFS.gaps.build({ ...c, rebuild: true })?.cards ?? []).flatMap((card) =>
    card.type === 'rows' ? card.rows.map((r) => ({ card: card.id, id: r.id })) : [],
  )
}

export type GapsChange = {
  ran: boolean // the coverage check finished again since MarshBot last spoke of the gaps
  failed: boolean // it failed again since then
  cleared: string[] // what cleared, as clauses
  fresh: number // rows no gaps card showed before
  before: number // rows open when MarshBot last spoke
  open: number // rows open now
  cards: Card[] // gaps cards of a kind no earlier card has, for the re-check turn to show
}

/**
 * Returns how the gaps raised this session changed since MarshBot last spoke of them, or null when
 * nothing changed, no gaps were raised, another visit holds them, or the stage has moved past
 * Capture (its gap rows were only dropped by the move, never cleared: item 1).
 */
export function gapsChange(s: StoredSession, c: TopicCtx): GapsChange | null {
  if (!STAGE_TOPICS[c.brief.stage].includes('gaps') || gapsHeld(c)) return null
  const shown = s.turns.filter((t) => t.topic === 'gaps' || t.topic === 'recheck')
  if (!shown.length) return null
  const rows = shown.flatMap((t) =>
    t.cards.flatMap((card) =>
      card.type === 'rows' ? card.rows.map((r) => ({ card: localId(card.id), row: r })) : [],
    ),
  )
  const live = liveGapRows(c)
  const isLive = (card: string, id: string) => live.some((l) => l.card === card && l.id === id)
  const before = rows.filter((r) => r.row.end.type === 'open')
  const gone = before.filter((r) => !isLive(r.card, r.row.id))
  const fresh = live.filter((l) => !rows.some((r) => r.card === l.card && r.row.id === l.id))
  // Spoken of last: the gaps turn, or the latest re-check (or failed re-check) turn.
  const spoke = s.turns
    .filter((t) => ['gaps', 'recheck', 'recheck-failed'].includes(t.topic))
    .at(-1)!.at
  const { status, checkedAt } = c.brief.coverage
  const since = !!checkedAt && new Date(checkedAt).toISOString() > spoke
  const ran = status === 'done' && since && (before.length > 0 || live.length > 0)
  const failed = status === 'failed' && since
  if (!ran && !failed && !gone.length) return null
  const covered = gone.filter((r) => r.card === 'not-covered').length
  const thin = gone.length - covered
  const kinds = new Set(rows.map((r) => r.card))
  return {
    ran,
    failed,
    cleared: [
      // "cleared", not "covered": a row also clears when its item is marked "Not seen" (item 17).
      covered ? `${count(covered, 'checklist item')} ${covered === 1 ? 'is' : 'are'} cleared` : '',
      thin ? `${count(thin, 'note')} ${thin === 1 ? 'is' : 'are'} no longer thin` : '',
    ].filter(Boolean),
    fresh: fresh.length,
    before: before.length,
    open: live.length,
    // A new row of a kind no earlier card shows would have nowhere to appear (item 2).
    cards: ran
      ? (DEFS.gaps.build({ ...c, rebuild: true })?.cards ?? []).filter(
          (card) => !kinds.has(localId(card.id)) && fresh.some((f) => f.card === card.id),
        )
      : [],
  }
}

/**
 * Returns the re-check turn's words: that it checked again, what cleared, any new gaps and what is
 * still open, e.g. "… 1 note is no longer thin, and 1 new gap turned up. 16 gaps are still open."
 */
export function recheckSays({ cleared, fresh, before, open }: GapsChange): Say[] {
  const turned = fresh ? `${count(fresh, 'new gap')} turned up` : ''
  const changed = cleared.length
    ? `${upperFirst(andList(cleared))}${turned ? `, and ${turned}` : ''}.`
    : before
      ? `Nothing has cleared yet${turned ? `, and ${turned}` : ''}.`
      : `${upperFirst(turned)}.`
  const text = [
    "I've checked the gaps again after your changes.",
    changed,
    open
      ? `${count(open, 'gap')} ${open === 1 ? 'is' : 'are'} still open.`
      : 'Every gap is closed now.',
  ].join(' ')
  return [{ text, tone: cleared.length ? 'good' : 'normal' }]
}

/** What MarshBot says, once per failure, when the coverage check fails after the gaps were raised (item 3). */
export const RECHECK_FAILED =
  "I couldn't check the gaps again just now. What's on screen is from the last check, and I'll try again in a minute."
