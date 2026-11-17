// Date cell (CP-23, v2 section 6): icon, date and a second line. Report due shows the
// day count in one of four states; Next survey passes its site as the second line (round 13).
// Called by the assessment and client tables and the client page. Calls Icon.
import { Icon } from '../core/Icon'

export type ReportDueProps = {
  // ISO date (2026-11-09) or Date; empty = no due date.
  date?: string | Date | null
  // "Today" for the day count; tests pass a fixed day.
  today?: Date
  // Finished work (finalised or archived): the date alone, in grey, never late.
  plain?: boolean
  // A second line in place of the day count (Next survey's site), in grey, never late.
  note?: string
  // False leaves the calendar icon out (the Clients list's Next survey, round 14).
  icon?: boolean
  // The word for a date that is today: "Today" in MarshBot's Details panel (AS-06).
  todayLabel?: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = 86_400_000
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Returns the whole days from `today` to `date` (negative once past) and whether that is late,
    soon (within 7 days) or ok. The one rule for every date cell, MarshBot's rail too (AS-06). */
export function dueState(date: string | Date, today = new Date()) {
  const d =
    typeof date === 'string' ? new Date(date.length === 10 ? `${date}T00:00:00` : date) : date
  // Whole days between local midnights, so the time of day never tips the count.
  const days = Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      DAY,
  )
  const state: 'late' | 'soon' | 'ok' = days < 0 ? 'late' : days <= 7 ? 'soon' : 'ok'
  return { d, days, state }
}

/** Returns the date cell: late (red), within 7 days (amber), on track (grey) or Not set. */
export function ReportDue({
  date,
  today = new Date(),
  plain = false,
  note,
  icon = true,
  todayLabel = 'today',
}: ReportDueProps) {
  if (!date) {
    return (
      <span className="ds-due ds-due-none">
        {icon && <Icon name="calendar" size={16} />}
        Not set
      </span>
    )
  }
  const due = dueState(date, today)
  const { d, days } = due
  const state = plain || note !== undefined ? 'ok' : due.state
  const glyph = state === 'late' ? 'calendar-x' : state === 'soon' ? 'calendar-clock' : 'calendar'
  const count = days < 0 ? `${plural(-days)} late` : days === 0 ? todayLabel : `in ${plural(days)}`
  return (
    <span className={`ds-due ds-due-${state}`}>
      {icon && <Icon name={glyph} size={16} />}
      <span>
        <span className="ds-due-date">
          {d.getDate()} {MONTHS[d.getMonth()]} {d.getFullYear()}
        </span>
        {plain ? null : (
          <span className="ds-due-note" title={note}>
            {note ?? count}
          </span>
        )}
      </span>
    </span>
  )
}
