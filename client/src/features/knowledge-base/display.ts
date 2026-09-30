// How knowledge documents' details read on screen (IN-01, KB-01). Used by the
// recent uploads list (KnowledgeBase.tsx) and the documents list
// (KnowledgeDocuments.tsx).
import { JURISDICTIONS } from '../assessments/demo-data'
import type { SourceType } from './api'

export const SOURCE_LABELS: Record<SourceType, string> = {
  fm_standard: 'FM standard',
  nfpa_standard: 'NFPA standard',
  marsh_report: 'Marsh report',
}

/** Returns a country's name from its code, "All countries" for all. */
export function countryName(code: string): string {
  if (code === 'all') return 'All countries'
  return JURISDICTIONS.find((j) => j.value === code)?.label ?? code
}

/** Returns a facility type as shown, "All facility types" for all. */
export function facilityName(type: string): string {
  return type === 'all' ? 'All facility types' : type
}

/**
 * Returns a calendar date as "12 Mar 2024". UTC, because the stored date has
 * no time. The month is cut to three letters, since some browsers write
 * September as "Sept".
 */
export function calendarDate(iso: string): string {
  const date = new Date(iso)
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3)
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}
