// MarshBot's own words around the topics (AS-06 round 5): the greeting or
// catch-up that opens a session, the engineer's reply as said, and MarshBot's
// answer to it. Friendly full sentences, digits for numbers (rule 3).
// Called by advance.ts.
import type { StoredSession } from '../../../models/assistant-thread.model'
import { dayOf, daysBetween, inDays, partOfDay, shortDay, weekdayDay, weekdayName } from '../dates'
import { STAGE_LABELS } from '../stage'
import type { BriefItem, Reply, Say, Stage } from '../types'
import { andList, count, lowerFirst, upperFirst } from './cards'
import { droppedByStageMove } from './session'
import type { TopicCtx } from './types'

// Where the assessment stands, in one sentence per stage.
function stageLine(ctx: TopicCtx): string {
  const f = ctx.facts
  const n = f.observations
  const surveyDay =
    !!f.surveyStart && f.surveyStart <= ctx.today && ctx.today <= (f.surveyEnd ?? f.surveyStart)
  const lines: Record<Stage, string> = {
    setup: `${f.site} is new, so let's get it ready.`,
    prepare:
      f.surveyStart && f.surveyStart >= ctx.today
        ? `${f.site} is in the Prepare stage, and the survey is ${inDays(daysBetween(ctx.today, f.surveyStart))}.`
        : `${f.site} is in the Prepare stage.`,
    capture: !n
      ? `${f.site} is in the Capture stage. Nothing is recorded yet.`
      : surveyDay
        ? `${f.site} is in the Capture stage, and you already have ${count(n, 'observation')} in, which is a great start for survey day.`
        : `${f.site} is in the Capture stage, with ${count(n, 'observation')} so far.`,
    ready_for_generation: `Capture on ${f.site} is done, so it's in the Ready for generation stage.`,
    generate: `${f.site} is in the Generate stage, with ${f.draftedParts} of 11 sections drafted.`,
    review: `${f.site} is in the Review stage.`,
    ready_to_export: `${f.site} is in the Ready to export stage.`,
    exported: `${f.site} is in the Exported stage.`,
  }
  return lines[ctx.brief.stage]
}

// The report date when it matters, never a row: close (within 7 days) it is a sentence at the
// end of the greeting; past, it is its own message that stands out (round 8, item 13).
function dueSays(ctx: TopicCtx): { soon: string; overdue: Say[] } {
  const due = ctx.facts.reportDue
  if (!due || ctx.brief.stage === 'exported') return { soon: '', overdue: [] }
  const days = daysBetween(ctx.today, due)
  if (days < 0)
    return {
      soon: '',
      overdue: [
        {
          text: `The report is ${count(-days, 'day')} overdue, so let's keep it moving.`,
          tone: 'alert',
        },
      ],
    }
  return {
    soon: days <= 7 ? `Just so you know, the report is due ${inDays(days)}.` : '',
    overdue: [],
  }
}

// "the morning walk", "the Loading Bay 2 recording": how a sorted item is named in the catch-up.
function named(item: BriefItem): string {
  if (item.kind === 'failed-recording') return `the ${item.title} recording`
  if (item.kind === 'failed-page') return `the ${item.title} page`
  if (item.kind === 'site-walks') return `the ${lowerFirst(item.title)}`
  return item.title
}

/**
 * Returns the session's opening words: "Good morning, Alex!" and where things
 * stand, or, after an earlier session, what changed since (H1): one sentence for one change, a
 * tick list for more. A report past its due date follows as a stand-out message.
 */
export function greetingSays(ctx: TopicCtx, last: StoredSession | null): Say[] {
  const hello = `Good ${partOfDay(ctx.now).toLowerCase()}, ${ctx.first}!`
  const { soon, overdue } = dueSays(ctx)
  const plain = (...words: string[]): Say[] => [
    { text: [...words, soon].filter(Boolean).join(' '), tone: 'normal' },
    ...overdue,
  ]
  if (!last) return plain(hello, stageLine(ctx))
  const f = ctx.facts
  // Only what was open in the last session and is resolved now (a), (b), and
  // never a title an open item still has (c), nor an item the stage moving on dropped (d): a reviewed walk's "complete the
  // fields" gap shares "Morning walk" with the walk still waiting for review, and
  // a skipped task is still open, so neither is claimed as sorted.
  const lastEnd = last.turns.at(-1)?.at ?? last.startedAt
  const openTitles = new Set(ctx.open.map((i) => i.title.toLowerCase()))
  const sorted = [
    ...new Set(
      ctx.brief.items
        .filter(
          (i) =>
            i.resolvedAt &&
            !droppedByStageMove(ctx.brief, i) &&
            i.resolvedAt > last.startedAt &&
            i.firstSeenAt <= lastEnd &&
            (i.weight === 'fix_now' || i.weight === 'gap') &&
            i.kind !== 'report-due' &&
            !openTitles.has(i.title.toLowerCase()),
        )
        .map(named),
    ),
  ]
  // Each change is one clause: at most 2 sorted items by name, the rest counted.
  const more = sorted.length - 2
  const added = f.observations - (last.observations ?? f.observations)
  const clauses = [
    ...(sorted.length > 3
      ? [...sorted.slice(0, 2).map((s) => `${s} is sorted`), `${more} more are sorted`]
      : sorted.map((s) => `${s} is sorted`)),
    added > 0 ? `you added ${count(added, 'more observation')}` : '',
    last.stage !== ctx.brief.stage
      ? `it's moved on to the ${STAGE_LABELS[ctx.brief.stage]} stage`
      : '',
  ].filter(Boolean)
  if (!clauses.length) return plain(hello, stageLine(ctx))
  const lastDay = dayOf(new Date(last.startedAt))
  const since = daysBetween(lastDay, ctx.today) === 1 ? 'yesterday' : weekdayName(lastDay)
  const total = added > 0 ? `That brings you to ${f.observations}.` : ''
  if (clauses.length === 1) return plain(`${hello} Since ${since}, ${clauses[0]}.`, total)
  // The catch-up as a tick list (round 8, item 5): the rules mark each tick, the AI only rewords.
  const after = [total, soon].filter(Boolean).join(' ')
  return [
    { text: `${hello} Here's what has changed since ${since}.`, tone: 'normal' },
    ...clauses.map((c): Say => ({ text: upperFirst(c), tone: 'tick' })),
    ...(after ? [{ text: after, tone: 'normal' } as Say] : []),
    ...overdue,
  ]
}

const LABELS: Record<Reply['id'], string> = {
  'nothing-more': 'Nothing more to add',
  'ready-to-generate': "That's everything",
  'another-visit': 'Another visit',
  'add-observations': 'Add observations',
  'export-again': 'Export again',
  'not-now': 'Not now',
  skip: 'Skip for now',
  'what-else': 'What else?',
  'generate-anyway': 'Generate anyway',
}

/** Returns the engineer's reply as their bubble says it ("Another visit on Fri 20 Nov", as the button). */
export function replyLabel(reply: Reply['id'], date?: string): string {
  return reply === 'another-visit' && date ? `Another visit on ${weekdayDay(date)}` : LABELS[reply]
}

/**
 * A topic's name on the agenda above the conversation and in the "Up next" line. Topics that
 * share a name are one step: only one of the three ways Capture wraps up is ever raised.
 */
export const TOPIC_TITLES: Record<string, string> = {
  todo: 'To Do',
  setup: 'Setup',
  'before-survey': 'Before the Survey',
  checklist: 'Checklist',
  tidy: 'To Tidy Up',
  gaps: 'Gaps',
  'visit-question': 'Wrap Up',
  'visit-set': 'Wrap Up',
  'all-clear': 'Wrap Up',
  'before-generate': 'Before You Generate',
  ready: 'Ready to Generate',
  sections: 'Sections',
  outline: 'Review',
  reminders: 'While You Were Away',
  'draft-again': 'Draft Again',
  'export-ready': 'Export',
  exported: 'Exported',
  rest: 'Also Worth a Look',
}

// The choices that move the stage on, and where to: said under the choices, so it is clear
// before the press that it moves the assessment's progress forward (round 8, item 10).
const MOVES: Partial<Record<Reply['id'], Stage>> = {
  'nothing-more': 'prepare',
  'ready-to-generate': 'ready_for_generation',
}

/** Returns the line under the choices for a reply that moves the stage on, else undefined. */
export function moveHint(id: Reply['id']): string | undefined {
  const to = MOVES[id]
  return (
    to &&
    `Clicking “${LABELS[id]}” will move the assessment's status forward to ${STAGE_LABELS[to]}.`
  )
}

/** Returns a reply as the choices offer it. */
export const offer = (id: Reply['id'], primary = true): Reply => ({
  id,
  label: LABELS[id],
  primary,
  picksDate: id === 'another-visit',
  link: null,
})

/**
 * Returns MarshBot's answer to a reply, and whether it is the green
 * acknowledgement; null when the next topic answers it ('what-else', 'generate-anyway').
 * `left` names the skipped tasks that stay open.
 */
export function answerWords(
  ctx: TopicCtx,
  reply: Reply['id'],
  date: string | undefined,
  left: string[],
): { text: string; good: boolean } | null {
  const site = ctx.facts.site
  switch (reply) {
    case 'nothing-more':
      return { text: "Thanks! I've moved this on to the Prepare stage.", good: true }
    case 'ready-to-generate':
      return { text: `Great! I've moved ${site} on to Ready for generation.`, good: true }
    case 'another-visit':
      return {
        text: `Done! The survey now ends on ${shortDay(date ?? ctx.today)}, and ${site} stays in the Capture stage until then. I'll hold the gaps until you're back from site. Add whatever you gather on the day.`,
        good: true,
      }
    case 'skip': {
      // Names what stays (1 or 2 places), else counts it (round 7, item 10). The verb and the
      // count follow the names printed, so two tasks with one title read "it's" (review #18);
      // a task with no title ('') is counted, never printed as an empty name (review #30).
      const names = [...new Set(left.filter(Boolean))]
      const n = names.length || left.length
      const what = names.length && names.length <= 2 ? andList(names) : `Those ${n}`
      return {
        text: n
          ? `No problem. ${what} will stay in To Do until ${names.length === 1 ? "it's" : "they're"} done.`
          : 'No problem.',
        good: false,
      }
    }
    case 'export-again':
      return { text: 'Sure! The newer version is ready to go from the Export tab.', good: false }
    case 'not-now':
      return { text: "No problem. I'll ask again if anything else changes.", good: false }
    default:
      return null
  }
}
