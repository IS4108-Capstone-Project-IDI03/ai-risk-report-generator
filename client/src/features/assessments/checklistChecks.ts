import type { CheckResult, ChecklistItem, ReportSection } from './api'
import { JURISDICTIONS } from './demo-data'

// How an item was answered on site (CP-31), as the checklist names it.
export const CHECK_LABEL: Record<CheckResult, string> = {
  confirmed: 'Confirmed',
  differs: 'Differs',
  not_seen: 'Not seen',
  not_applicable: 'Not applicable',
}
export const CHECK_TONE: Record<CheckResult, string> = {
  confirmed: 'low',
  differs: 'moderate',
  not_seen: 'neutral',
  not_applicable: 'neutral',
}

// How many of an area's items are answered, and how many remain (AC6).
export function areaProgress(items: ChecklistItem[]) {
  const checked = items.filter((i) => i.check).length
  return { checked, remaining: items.length - checked }
}

// What a report section still needs before it can be drafted (AC7): the
// gateway's own count of usable observations filed under it, which includes
// those captured without the checklist. Null for an area that is not a
// drafted section, such as the priority risks.
export function draftingNeed(areaId: string, sections: ReportSection[] | null) {
  const section = sections?.find((s) => s.id === areaId)
  if (!section) return null
  return Math.max(0, section.minObservations - section.usableObservations)
}

export function needLabel(need: number) {
  return need === 0
    ? 'Enough observations to draft'
    : `Needs ${need} more observation${need === 1 ? '' : 's'} to draft`
}

// A question's length rule (CP-37): about 20 words; over 25 is refused.
export const WORDS_TARGET = 20
export const WORDS_MAX = 25
export const WORDS_MESSAGE = 'Keep it to about 20 words.'
/** Returns how many words the text has. */
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// The checklist's shared look, on the tab and on site.
export const card = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
} as const
export const muted = {
  margin: 0,
  fontSize: 'var(--text-small-size)',
  color: 'var(--text-secondary)',
} as const
export const caption = { ...muted, fontSize: 'var(--text-caption-size)' } as const
export const heading = { margin: 0, fontSize: '17px', fontWeight: 600 } as const

export const country = (code: string) => JURISDICTIONS.find((j) => j.value === code)?.label ?? code
