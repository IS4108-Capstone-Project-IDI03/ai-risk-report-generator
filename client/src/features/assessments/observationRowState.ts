// The one rule for an observation's state on the Observations tab (CP-24): its status words,
// the row's tint and reason line, and the To check filter and count. Pure: no React, no network.
// Called by toEntry in useAssessmentWorkflow.tsx and by observationFilters.ts.
import type { SavedSuggestion } from './api'

export type RowStatus =
  'Transcribing' | 'Reading' | 'Transcription failed' | 'Reading failed' | 'To check' | 'Complete'
export type RowTint = 'unsure' | 'failed' | 'reading' | null

// The parts of an observation the rule reads, so a test needs no whole observation.
export type RowStateInput = {
  recordings?: { status: string }[]
  pages?: { status: string | null }[]
  suggestion?: SavedSuggestion | null
  toCheck?: boolean
  // Only the photo description can still be reading; the old category half is never read.
  interpretation?: { photos: { status: string } | null } | null
  cats: string[]
  sev: string
}

/** Returns the status words, the tint ('unsure' amber, 'failed' red, 'reading' blue) and the reason line. */
export function rowStateOf(o: RowStateInput): {
  status: RowStatus
  tint: RowTint
  reason: string | null
} {
  const media = [...(o.recordings ?? []), ...(o.pages ?? [])].map((m) => m.status)
  const reading =
    o.suggestion?.status === 'reading' || o.interpretation?.photos?.status === 'interpreting'
  // First match wins.
  if (media.includes('transcribing')) return { status: 'Transcribing', tint: null, reason: null }
  if (reading) return { status: 'Reading', tint: 'reading', reason: null }
  if (media.includes('failed')) return { status: 'Transcription failed', tint: null, reason: null }
  if (o.suggestion?.status === 'failed')
    return { status: 'Reading failed', tint: 'failed', reason: 'Suggestion failed' }
  if (o.toCheck) {
    const category = !o.cats.length || !!o.suggestion?.category?.notSure
    const severity = !o.sev || !!o.suggestion?.severity?.notSure
    const what = category && severity ? 'category and severity' : category ? 'category' : 'severity'
    // Nothing was filled in (nothing to read): there is no value to check, so it asks for a choice.
    const filled = !!o.suggestion?.category?.notSure || !!o.suggestion?.severity?.notSure
    return { status: 'To check', tint: 'unsure', reason: (filled ? 'Check ' : 'Choose ') + what }
  }
  return { status: 'Complete', tint: null, reason: null }
}

// Still being worked on: left out of To check until it settles.
const WORKING: string[] = ['Transcribing', 'Reading']

/** Returns whether the To check filter and the footer's count include this observation. */
export const inToCheck = (o: { status?: string; toCheck?: boolean }) =>
  !!o.toCheck && !WORKING.includes(o.status ?? '')

/** Returns the footer's "N to check" number: exactly the rows the To check filter shows. */
export const toCheckCount = (list: { status?: string; toCheck?: boolean }[]) =>
  list.filter(inToCheck).length

/** Returns whether the Status filter's choice matches; To check also takes a failed suggestion. */
export const matchesStatus = (o: { status?: string; toCheck?: boolean }, choice: string) =>
  choice === 'To check' ? inToCheck(o) : (o.status ?? 'Complete') === choice
