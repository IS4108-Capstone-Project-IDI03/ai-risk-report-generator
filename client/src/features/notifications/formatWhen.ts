// A literal, mono timestamp like "11 Apr 09:22" (docs/design-system.md: dates
// are literal and in mono, never relative). Falls back to the raw value if the
// date cannot be parsed, rather than showing "Invalid Date".
/** Returns a literal timestamp for a notification or request. */
export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

// Whole days between `date` and `now`, by the calendar: 0 today, 1 yesterday.
const daysAgo = (date: Date, now: Date) => {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((midnight(now) - midnight(date)) / 86_400_000)
}

/**
 * Returns the bell's time (board 11): "Today, 09:40", "Yesterday, 15:10", else "3 Nov, 15:10".
 * `now` is "today", so a test can fix the day.
 */
export function formatBellWhen(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const days = daysAgo(date, now)
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${day}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Returns the Inbox's short time (board 01): "11:42" today, "Yesterday", else "3 Nov".
 * `now` is "today", so a test can fix the day.
 */
export function formatInboxWhen(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const days = daysAgo(date, now)
  if (days === 0) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
