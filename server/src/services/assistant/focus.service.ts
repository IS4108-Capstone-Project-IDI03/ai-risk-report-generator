// The Focus list (AS-06 AC 12): the engineer's own assessments that need them
// most, ranked overdue, then Fix now, then least time to spare. Called by the
// assessment list (assessment.service.ts), whose rows carry each one's priority
// and rank; the browser builds Focus from them. Reads assessments, MarshBot
// briefs and report sections.
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { ReportSectionModel } from '../../models/report-section.model'
import type { ListedSite } from '../assessment.service'
import { daysBetween, dayOf, isoDay } from './dates'
import { plural } from './item'
import { STAGES, type BriefItem, type Priority, type PriorityReason, type Stage } from './types'

// Days of work each stage still needs (spec Architecture 6). Setup and Prepare
// together take half a day before the survey; the rest count before the report is due.
export const FOCUS_WORK_DAYS: Partial<Record<Stage, number>> = {
  prepare: 0.5,
  generate: 1,
  review: 1.5,
  ready_to_export: 0.5,
}
const BEFORE_SURVEY: Stage[] = ['setup', 'prepare']
// Less spare time than this puts an assessment in Focus.
const SHORT_ON_TIME_DAYS = 3
const REASONS: PriorityReason[] = ['overdue', 'fix_now', 'short_on_time']

export type FocusItem = {
  reference: string
  site: string
  client: string
  reportDueDate: string | null
  stage: Stage
  priority: Priority
}

// What priorityFor reads about one assessment.
export type PriorityInput = {
  stage: Stage
  siteVisitDate?: Date
  reportDueDate?: Date
  fixNow?: BriefItem // its first open Fix now item
  drafted: boolean // any report section drafted
}
// A priority before ranking, with how urgent it is within its reason (lower first).
export type Unranked = Omit<Priority, 'rank'> & { urgency: number }

// Whole calendar days from `today` ('YYYY-MM-DD') to a stored date.
const daysTo = (date: Date, today: string) => daysBetween(today, isoDay(date)!)

// Days of work left in the stages from `stage` on that fall within `group`.
function workLeft(stage: Stage, inGroup: (s: Stage) => boolean) {
  return STAGES.slice(STAGES.indexOf(stage))
    .filter(inGroup)
    .reduce((sum, s) => sum + (FOCUS_WORK_DAYS[s] ?? 0), 0)
}

/**
 * Returns why an assessment needs the engineer most (overdue, Fix now, short
 * on time), or null. `today` is the day where the team works (dates.ts dayOf),
 * as MarshBot's own checks count it.
 */
export function priorityFor(a: PriorityInput, today: string): Unranked | null {
  const due = a.reportDueDate && daysTo(a.reportDueDate, today)
  if (due !== undefined && due < 0) {
    const text = `Report ${plural(-due, 'day')} overdue${a.drafted ? '.' : ', nothing drafted yet.'}`
    return { reason: 'overdue', text, urgency: due }
  }
  if (a.fixNow) {
    // A brief saved before `fact` existed falls back to its row's words.
    const text = a.fixNow.fact || [a.fixNow.title, a.fixNow.detail].filter(Boolean).join(' · ')
    return { reason: 'fix_now', text, urgency: due ?? Number.MAX_SAFE_INTEGER }
  }
  // Spare time against each deadline still ahead: the survey while preparing, and the report.
  const survey = a.siteVisitDate && daysTo(a.siteVisitDate, today)
  const spares: [number, string][] = []
  if (BEFORE_SURVEY.includes(a.stage) && survey !== undefined && survey >= 0)
    spares.push([survey - workLeft(a.stage, (s) => BEFORE_SURVEY.includes(s)), 'the survey'])
  if (due !== undefined)
    spares.push([due - workLeft(a.stage, (s) => !BEFORE_SURVEY.includes(s)), 'the report is due'])
  const [spare, before] = spares.sort((x, y) => x[0] - y[0])[0] ?? [Infinity, '']
  if (spare >= SHORT_ON_TIME_DAYS) return null
  const days = Math.floor(spare)
  const text =
    days > 0
      ? `${plural(days, 'day')} to spare before ${before}.`
      : `No time to spare before ${before}.`
  return { reason: 'short_on_time', text, urgency: spare }
}

/** Returns the caller's own open assessments that need them, ranked (rank 1 first). */
export async function rankedFocus(userId: string, now = new Date()): Promise<FocusItem[]> {
  const today = dayOf(now)
  // a. The engineer's own assessments, not archived or exported.
  const assessments = await AssessmentModel.find({
    engineer: userId,
    archivedAt: { $exists: false },
    stage: { $ne: 'exported' },
  })
    .populate<{ site: ListedSite }>({ path: 'site', populate: { path: 'client', select: 'name' } })
    .lean()
  if (!assessments.length) return []
  // b. Their briefs and which have a drafted section, one query each (no query per assessment).
  const [briefs, drafted] = await Promise.all([
    AssistantBriefModel.find(
      { reference: { $in: assessments.map((a) => a.reference) } },
      'reference items',
    ).lean(),
    ReportSectionModel.distinct('assessment', {
      assessment: { $in: assessments.map((a) => a._id) },
    }),
  ])
  const itemsOf = new Map(briefs.map((b) => [b.reference, b.items as BriefItem[]]))
  const draftedIds = new Set(drafted.map(String))
  // c. Each one's priority, then rank: by reason, then by urgency within it.
  const found = assessments.flatMap((a) => {
    // Unset until `npm run migrate:stages` has run; a missing stage counts from the start.
    const stage: Stage = a.stage ?? 'setup'
    const fixNow = itemsOf.get(a.reference)?.find((i) => i.weight === 'fix_now' && !i.resolvedAt)
    const priority = priorityFor(
      { ...a, stage, fixNow, drafted: draftedIds.has(String(a._id)) },
      today,
    )
    return priority ? [{ a, stage, priority }] : []
  })
  found.sort(
    (x, y) =>
      REASONS.indexOf(x.priority.reason) - REASONS.indexOf(y.priority.reason) ||
      x.priority.urgency - y.priority.urgency,
  )
  return found.map(({ a, stage, priority: { reason, text } }, i) => ({
    reference: a.reference,
    site: a.site.name,
    client: a.site.client?.name ?? a.client ?? '',
    reportDueDate: isoDay(a.reportDueDate),
    stage,
    priority: { reason, text, rank: i + 1 },
  }))
}
