// How knowledge documents' details read on screen (IN-01, KB-01). Used by the
// recent uploads list (KnowledgeBase.tsx) and the documents list
// (KnowledgeDocuments.tsx).
import { JURISDICTIONS } from '../assessments/demo-data'
import type { SourceType } from './api'

// What an Unconfirmed detail (null, IN-05) reads as; components/DetailText.tsx
// shows it in muted text.
export const UNCONFIRMED = 'Unconfirmed'

export const SOURCE_LABELS: Record<SourceType, string> = {
  fm_standard: 'FM standard',
  nfpa_standard: 'NFPA standard',
  marsh_report: 'Marsh report',
}

/** Returns a source type as shown, "Unconfirmed" when null. */
export function sourceLabel(type: SourceType | null): string {
  return type ? SOURCE_LABELS[type] : UNCONFIRMED
}

/** Returns a country's name from its code, "All countries" for all. */
export function countryName(code: string | null): string {
  if (code === null) return UNCONFIRMED
  if (code === 'all') return 'All countries'
  return JURISDICTIONS.find((j) => j.value === code)?.label ?? code
}

/** Returns a facility type as shown, "All facility types" for all. */
export function facilityName(type: string | null): string {
  if (type === null) return UNCONFIRMED
  return type === 'all' ? 'All facility types' : type
}

/**
 * Returns a calendar date as "12 Mar 2024". UTC, because the stored date has
 * no time. The month is cut to three letters, since some browsers write
 * September as "Sept".
 */
export function calendarDate(iso: string | null): string {
  if (iso === null) return UNCONFIRMED
  const date = new Date(iso)
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3)
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}

/** Returns a file size as "12 KB" or "1.4 MB". */
export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Formats a processing duration as "1m 23s" or "45s" (E2). */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Returns a moment in the design system's literal form, e.g. "29 Sep 11:24". */
export function dateTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toTimeString().slice(0, 5)
  return `${date.getDate()} ${date.toLocaleString('en-GB', { month: 'short' }).slice(0, 3)} ${time}`
}
