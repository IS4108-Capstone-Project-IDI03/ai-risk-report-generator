import type { Stage } from '../marshbot/types'
import type { AssessmentStatus } from './api'

// An assessment's status as the work list and the client page (CP-18) word it.
export const STATUS_LABEL: Record<AssessmentStatus, string> = {
  not_started: 'Not started',
  capturing: 'Capturing',
  ready_to_generate: 'Ready to generate',
  draft: 'Draft',
  under_review: 'Under review',
  finalised: 'Finalised',
  archived: 'Archived',
}

// An assessment's stage as the Assessments list's pill and Stage filter word it (AS-06 AC 2).
export const STAGE_LABEL: Record<Stage, string> = {
  setup: 'Setup',
  prepare: 'Prepare',
  capture: 'Capture',
  ready_for_generation: 'Ready for generation',
  generate: 'Generate',
  review: 'Review',
  ready_to_export: 'Ready to export',
  exported: 'Exported',
}

/** Returns the word a row shows for where it stands: Archived, else its stage, else (a sample row
    with no stage) its status. The Stage filter matches on it too. */
export function rowStage(r: { status: string; stage?: Stage }) {
  return r.status === STATUS_LABEL.archived ? r.status : r.stage ? STAGE_LABEL[r.stage] : r.status
}

/** Returns the key a client page's visit shows as its pill and filters by: `archived`, else its
    stage, else (an older answer with no stage) its status. */
export function visitStage(v: { status: string; stage?: Stage }) {
  return v.status === 'archived' ? v.status : (v.stage ?? v.status)
}

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
