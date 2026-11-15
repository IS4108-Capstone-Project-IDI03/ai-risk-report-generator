// The calendar's dates and layout (CP-60): pure functions over the work list's
// assessments, so the screen only draws what these return. Days are ISO strings
// (2026-11-09), compared as text and stepped in UTC, so a clock change never
// moves one. Called by screens/Calendar.tsx and its components.
import type { Assessment, AssessmentStatus } from '../assessments/api'

const DAY = 86_400_000
export const MONTHS =
  'January February March April May June July August September October November December'.split(' ')
// Fixed names: newer ICU data renders en-GB September as "Sept" (assessments/format.ts).
const SHORT_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
export const WEEKDAYS = 'Mon Tue Wed Thu Fri Sat Sun'.split(' ')
const LONG_WEEKDAYS = 'Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' ')

const utc = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)

/** Returns today as the browser's calendar day. */
export const todayIso = () => new Date().toLocaleDateString('en-CA')
export const addDays = (day: string, days: number) => iso(utc(day) + days * DAY)
/** Returns 0 for Monday to 6 for Sunday. */
export const weekday = (day: string) => (new Date(utc(day)).getUTCDay() + 6) % 7
/** Returns the Monday of the day's week. */
export const weekStart = (day: string) => addDays(day, -weekday(day))
export const monthStart = (day: string) => day.slice(0, 7) + '-01'
/** Returns the first day of the month `months` away. */
export const addMonths = (day: string, months: number) =>
  iso(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1 + months, 1))
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY)

const parts = (day: string) => ({
  d: +day.slice(8, 10),
  m: +day.slice(5, 7) - 1,
  y: day.slice(0, 4),
})
/** Returns "12 Nov 2026", as every screen dates a day. */
export function formatDay(day: string) {
  const { d, m, y } = parts(day)
  return `${d} ${SHORT_MONTHS[m]} ${y}`
}
/** Returns "Thu 12 Nov", a day's heading in the phone list. */
export function formatWeekday(day: string) {
  const { d, m } = parts(day)
  return `${WEEKDAYS[weekday(day)]} ${d} ${SHORT_MONTHS[m]}`
}
/** Returns "Thursday 12 Nov 2026", a day's spoken name. */
export const spokenDay = (day: string) => `${LONG_WEEKDAYS[weekday(day)]} ${formatDay(day)}`
/** Returns a survey's days: "3 Nov 2026", or "3 Nov 2026 to 4 Nov 2026". */
export const formatSpan = (start: string, end: string | null) =>
  end && end !== start ? `${formatDay(start)} to ${formatDay(end)}` : formatDay(start)

export type View = 'month' | 'week'
/** Returns the period's name: "November 2026", or "9 – 15 Nov 2026" for a week from `cursor`. */
export function periodLabel(view: View, cursor: string) {
  const from = parts(cursor)
  if (view === 'month') return `${MONTHS[from.m]} ${from.y}`
  const to = parts(addDays(cursor, 6))
  const start = from.m === to.m ? `${from.d}` : `${from.d} ${SHORT_MONTHS[from.m]}`
  return `${start} – ${to.d} ${SHORT_MONTHS[to.m]} ${to.y}`
}

// An assessment as the calendar shows it.
export type CalendarItem = {
  reference: string
  site: string
  client: string
  // As stored: First survey, Resurvey or Follow-up visit.
  type: string
  status: AssessmentStatus
  // Its survey's first day, and its last when it runs over several; null when not set.
  start: string | null
  end: string | null
  due: string | null
  engineer: { id: string; name: string } | null
  contacts: { name: string; role: string | null }[]
}

/** Returns the assessments the calendar shows: all but the archived, which are finished with. */
export function toItems(assessments: Assessment[]): CalendarItem[] {
  return assessments
    .filter((a) => a.status !== 'archived')
    .map((a) => ({
      reference: a.reference,
      site: a.site.name,
      client: a.client,
      type: a.surveyType,
      status: a.status,
      start: a.siteVisitDate,
      // An end on the start day is one day, and one before it is not shown.
      end:
        a.siteVisitDate && a.siteVisitEndDate && a.siteVisitEndDate > a.siteVisitDate
          ? a.siteVisitEndDate
          : null,
      due: a.reportDueDate,
      engineer: a.engineer,
      contacts: a.siteContacts ?? [],
    }))
}

/** Returns whether the signed-in person may change the assessment's dates: its assigned engineer. */
export const canReschedule = (item: CalendarItem, meId: string) => item.engineer?.id === meId

// Late, within 7 days, on track, or done (finalised: nothing left to chase), as
// the Report due cell counts them (design-system ReportDue.tsx).
export type DueState = 'late' | 'soon' | 'ok' | 'done'
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`
/** Returns where a report due date stands and its words ("in 2 days"), or null with no date. */
export function dueOf(
  item: Pick<CalendarItem, 'due' | 'status'>,
  today: string,
): { state: DueState; note: string } | null {
  if (!item.due) return null
  if (item.status === 'finalised') return { state: 'done', note: 'finalised' }
  const days = daysBetween(today, item.due)
  if (days < 0) return { state: 'late', note: `${plural(-days)} late` }
  if (days === 0) return { state: 'soon', note: 'today' }
  return { state: days <= 7 ? 'soon' : 'ok', note: `in ${plural(days)}` }
}

// What the grid shows: both, or one kind only.
export type Show = '' | 'surveys' | 'due'
export type EntryKind = 'survey' | 'due'
// One bar or marker in a week: a survey across its days, or a report due on its day.
export type Entry = {
  key: string
  item: CalendarItem
  kind: EntryKind
  // Its first column in the week (0 is Monday) and how many it covers.
  col: number
  span: number
  // Its row among the week's entries, from 0.
  lane: number
  // A survey that started before this week, or runs on after it.
  fromEarlier: boolean
  toLater: boolean
}
export type Week = {
  start: string
  days: string[]
  entries: Entry[]
  // Per day, how many entries did not fit under `cap` lanes.
  more: number[]
  // How many lanes the shown entries use.
  lanes: number
}

/** Returns one week from its Monday: entries in lanes that never overlap, surveys first. */
export function layoutWeek(
  items: CalendarItem[],
  start: string,
  show: Show = '',
  cap = Infinity,
): Week {
  const end = addDays(start, 6)
  const found: Omit<Entry, 'lane'>[] = []
  for (const item of items) {
    if (show !== 'due' && item.start) {
      const last = item.end ?? item.start
      if (item.start <= end && last >= start) {
        const col = item.start < start ? 0 : weekday(item.start)
        found.push({
          key: `survey:${item.reference}`,
          item,
          kind: 'survey',
          col,
          span: (last > end ? 6 : weekday(last)) - col + 1,
          fromEarlier: item.start < start,
          toLater: last > end,
        })
      }
    }
    if (show !== 'surveys' && item.due && item.due >= start && item.due <= end)
      found.push({
        key: `due:${item.reference}`,
        item,
        kind: 'due',
        col: weekday(item.due),
        span: 1,
        fromEarlier: false,
        toLater: false,
      })
  }
  // Surveys before reports, long before short, then left to right; the reference
  // settles ties, so a week looks the same on every visit.
  found.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'survey' ? -1 : 1) ||
      b.span - a.span ||
      a.col - b.col ||
      a.item.reference.localeCompare(b.item.reference),
  )
  const taken: boolean[][] = []
  const more = [0, 0, 0, 0, 0, 0, 0]
  const entries: Entry[] = []
  for (const entry of found) {
    const columns = Array.from({ length: entry.span }, (_, i) => entry.col + i)
    let lane = 0
    while (columns.some((c) => taken[lane]?.[c])) lane++
    taken[lane] ??= []
    for (const c of columns) taken[lane][c] = true
    if (lane < cap) entries.push({ ...entry, lane })
    else for (const c of columns) more[c]++
  }
  return {
    start,
    days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    entries,
    more,
    lanes: Math.min(taken.length, cap),
  }
}

// How many entries a day shows in the month before "+N more".
export const MONTH_LANES = 3

/** Returns the six weeks that hold a month, each laid out under MONTH_LANES. */
export function monthWeeks(items: CalendarItem[], month: string, show: Show = ''): Week[] {
  const first = weekStart(monthStart(month))
  return Array.from({ length: 6 }, (_, i) =>
    layoutWeek(items, addDays(first, i * 7), show, MONTH_LANES),
  )
}

export type AgendaDay = { day: string; entries: Pick<Entry, 'key' | 'item' | 'kind'>[] }
/** Returns the days from `from` to `to` that hold something, each survey on its first day there. */
export function agenda(items: CalendarItem[], from: string, to: string, show: Show = '') {
  const days = new Map<string, AgendaDay['entries']>()
  const put = (day: string, entry: AgendaDay['entries'][number]) =>
    days.set(day, [...(days.get(day) ?? []), entry])
  for (const item of items) {
    if (show !== 'due' && item.start) {
      const last = item.end ?? item.start
      if (item.start <= to && last >= from)
        put(item.start < from ? from : item.start, {
          key: `survey:${item.reference}`,
          item,
          kind: 'survey',
        })
    }
    if (show !== 'surveys' && item.due && item.due >= from && item.due <= to)
      put(item.due, { key: `due:${item.reference}`, item, kind: 'due' })
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entries]): AgendaDay => ({
      day,
      entries: entries.sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === 'survey' ? -1 : 1) ||
          a.item.reference.localeCompare(b.item.reference),
      ),
    }))
}
