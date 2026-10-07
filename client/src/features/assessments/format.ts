// Fixed month names: newer ICU data renders en-GB September as "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

// `11 Apr 09:22`, the platform's literal date format, in local time.
export function formatDayTime(date: Date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// `11 Apr 2026 09:22`, the same with its year, where the year matters: an
// observation's capture time, which is evidence (CP-08 AC2).
export function formatDayYearTime(date: Date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// `4 Oct 2026`, a day in local time.
export function formatDay(date: Date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
