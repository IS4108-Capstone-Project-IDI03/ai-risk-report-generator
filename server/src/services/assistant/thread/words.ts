// MarshBot's own words around the topics (AS-06 round 5): the greeting or
// catch-up that opens a session, the engineer's reply as said, and MarshBot's
// answer to it. Friendly full sentences, digits for numbers (rule 3).
// Called by advance.ts.
import type { StoredSession } from '../../../models/assistant-thread.model'
import { dayOf, daysBetween, inDays, partOfDay, shortDay, weekdayDay, weekdayName } from '../dates'
import { STAGE_LABELS } from '../stage'
import type { BriefItem, Reply, Stage } from '../types'
import { andList, count, lowerFirst } from './cards'
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

// The report date, when it is close or past: a sentence, never a row.
function dueLine(ctx: TopicCtx): string {
  const due = ctx.facts.reportDue
  if (!due || ctx.brief.stage === 'exported') return ''
  const days = daysBetween(ctx.today, due)
  if (days < 0) return ` The report is ${count(-days, 'day')} overdue, so let's keep it moving.`
  return days <= 7 ? ` Just so you know, the report is due ${inDays(days)}.` : ''
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
 * stand, or, after an earlier session, what changed since (H1).
 */
export function greetingWords(ctx: TopicCtx, last: StoredSession | null): string {
  const hello = `Good ${partOfDay(ctx.now).toLowerCase()}, ${ctx.first}!`
  if (!last) return `${hello} ${stageLine(ctx)}${dueLine(ctx)}`
  const f = ctx.facts
  // Only what was open in the last session and is resolved now (a), (b), and
  // never a title an open item still has (c): a reviewed walk's "complete the
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
            i.resolvedAt > last.startedAt &&
            i.firstSeenAt <= lastEnd &&
            (i.weight === 'fix_now' || i.weight === 'gap') &&
            i.kind !== 'report-due' &&
            !openTitles.has(i.title.toLowerCase()),
        )
        .map(named),
    ),
  ]
  const shown = sorted.length > 3 ? [...sorted.slice(0, 2), `${sorted.length - 2} more`] : sorted
  const added = f.observations - (last.observations ?? f.observations)
  const clauses = [
    sorted.length
      ? `${andList(shown)} ${sorted.length === 1 ? 'is' : sorted.length === 2 ? 'are both' : 'are'} sorted`
      : '',
    added > 0 ? `you added ${count(added, 'more observation')}` : '',
    last.stage !== ctx.brief.stage
      ? `it's moved on to the ${STAGE_LABELS[ctx.brief.stage]} stage`
      : '',
  ].filter(Boolean)
  if (!clauses.length) return `${hello} ${stageLine(ctx)}${dueLine(ctx)}`
  const lastDay = dayOf(new Date(last.startedAt))
  const since = daysBetween(lastDay, ctx.today) === 1 ? 'yesterday' : weekdayName(lastDay)
  const total = added > 0 ? ` That brings you to ${f.observations}.` : ''
  return `${hello} Since ${since}, ${clauses.join(', and ')}.${total}${dueLine(ctx)}`
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
