// Day and time helpers for MarshBot's rules and words (AS-06), in the team's
// time zone (REPORT_TIME_ZONE). Days are 'YYYY-MM-DD' strings, as the API sends them.
import { config } from '../../config'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

const part = (at: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: config.reportTimeZone, ...options }).format(at)

/** Returns the calendar day `at` falls on where the team works, as 'YYYY-MM-DD'. */
export function dayOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.reportTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Returns a stored UTC-midnight date as 'YYYY-MM-DD', or null. */
export function isoDay(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null
}

/** Returns the whole days from day `a` to day `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
}

/** Returns "today", "tomorrow" or "in 3 days" (`count` writes the number, e.g. phrases.ts word). */
export function inDays(n: number, count: (n: number) => string = String): string {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${count(n)} days`
}

/** Returns "20 Nov 2026" for '2026-11-20'. */
export function longDay(day: string): string {
  const d = new Date(day)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Returns "Fri 20 Nov 2026" for '2026-11-20'. */
export function weekdayDay(day: string): string {
  return `${WEEKDAYS[new Date(day).getUTCDay()]} ${longDay(day)}`
}

/** Returns "Friday" for '2026-11-20'. */
export function weekdayName(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(day),
  )
}

/** Returns "10:42" for a moment, in the team's time zone. */
export function clockTime(at: Date): string {
  return part(at, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Returns "Morning", "Afternoon" or "Evening" for a moment, in the team's time zone. */
export function partOfDay(at: Date): string {
  const hour = Number(part(at, { hour: '2-digit', hour12: false }))
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening'
}
