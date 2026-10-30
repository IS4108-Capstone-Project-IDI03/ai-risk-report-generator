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
