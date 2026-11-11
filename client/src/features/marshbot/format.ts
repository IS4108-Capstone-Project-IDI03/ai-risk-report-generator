// How MarshBot's screen words dates and times (AS-06): full days on the rail, short days on the
// phone bar and lanes, and when a message was said. Used across features/marshbot.
import { dueState } from '../../design-system'
import { formatDay } from '../assessments/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

// A "YYYY-MM-DD" day is read as that day here; new Date("2026-11-14") would be UTC midnight,
// the day before in any timezone west of London.
/** Returns the Date for a "YYYY-MM-DD" day or an ISO time, in local time. */
export function toDate(value: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return day ? new Date(+day[1], +day[2] - 1, +day[3]) : new Date(value)
}

/** Returns "14 Nov 2026". */
export const fullDay = (value: string) => formatDay(toDate(value))

/** Returns "14 Nov". */
export function shortDay(value: string) {
  const d = toDate(value)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** Returns "Fri 20 Nov 2026", the day an engineer picked for another visit. */
export function visitDay(value: string) {
  const d = toDate(value)
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${formatDay(d)}`
}

/** Returns the whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  const start = toDate(from)
  const end = toDate(to)
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((b - a) / DAY_MS)
}

/** Returns today's "YYYY-MM-DD" in local time. */
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Dates on the rail and phone bar: amber within a week, red once a report is late
// (the design system's Report due rule, without the "in N days").
/** Returns 'late', 'soon' or null for a day; `canBeLate` is false for a survey date. */
export function dateTone(day: string | null, canBeLate: boolean): 'late' | 'soon' | null {
  if (!day) return null
  const { state } = dueState(day)
  if (state === 'late') return canBeLate ? 'late' : null
  return state === 'soon' ? 'soon' : null
}

/** Returns when something was said: "just now", "09:12", "Monday 09:12" or "3 Nov 2026, 09:12". */
export function saidAt(iso: string, now = new Date()) {
  const d = new Date(iso)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (now.getTime() - d.getTime() < 60_000) return 'just now'
  const days = daysBetween(iso, now.toISOString())
  if (days === 0) return time
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${time}`
  return `${formatDay(d)}, ${time}`
}
