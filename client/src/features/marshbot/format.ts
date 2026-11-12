// How MarshBot's screen words dates and times (AS-06): short days on the rail, phone bar and lanes,
// the picked visit day, and the time dividers in the thread. Used across features/marshbot.
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

/** Returns "Fri 20 Nov", a day in a reply or a toast. */
export function weekDay(value: string) {
  const d = toDate(value)
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${shortDay(value)}`
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

/** Returns "10:41", the time of a turn. */
export function clock(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Returns a session's divider: "Today, 10:23", "Yesterday, 10:23", "Friday, 09:05" within a
    week, else "Wednesday 11 Nov, 10:23". */
export function sessionTime(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = daysBetween(iso, now.toISOString())
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : days < 7
          ? WEEKDAYS[d.getDay()]
          : `${WEEKDAYS[d.getDay()]} ${shortDay(iso)}`
  return `${day}, ${clock(iso)}`
}
