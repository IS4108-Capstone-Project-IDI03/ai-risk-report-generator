// Small wording helpers shared by the client page and the Clients table.
import type { AssessmentType } from '../../design-system'
import { JURISDICTIONS } from '../assessments/demo-data'
import { formatDay, formatDayYearTime } from '../assessments/format'
import type { Stamp } from './api'

/** Returns the country's name for a jurisdiction code; a code the list lacks (IE) is named by the browser. */
export const country = (code: string) => {
  const listed = JURISDICTIONS.find((j) => j.value === code)?.label
  if (listed) return listed
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
/** Returns a day as "02 Nov 2026", or Unscheduled. */
export const day = (iso: string | null) =>
  iso ? formatDay(new Date(iso + 'T00:00:00')) : 'Unscheduled'
// Who changed it and when, as an observation says it (CP-08):
// "Edited by Alex Rowe · 02 Nov 2026 14:02".
/** Returns who changed something and when, e.g. "Edited by Alex Rowe · 02 Nov 2026 14:02". */
export const stampText = (verb: string, s: Stamp) =>
  `${verb} by ${s.by.name} · ${formatDayYearTime(new Date(s.at))}`
/** Returns a count with its noun, e.g. "2 sites". */
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
/** Returns a file size as "12 KB" or "1.8 MB". */
export const fileSize = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`
      : bytes < 1_000_000_000
        ? `${(bytes / 1_000_000).toFixed(1)} MB`
        : `${(bytes / 1_000_000_000).toFixed(1)} GB`
/** Returns an assessment type as the design system names it; the old "Follow-up visit" is Follow-up. */
export const assessmentType = (surveyType: string): AssessmentType =>
  /follow/i.test(surveyType)
    ? 'Follow-up'
    : /^resurvey/i.test(surveyType)
      ? 'Resurvey'
      : 'First survey'
