// MarshBot's shared words (AS-06): number words for the checks, a first name,
// and the facts the conversation is written from. Called by checks/ and thread/.
import type { Stage } from './types'

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Returns "two" for 2, or the digits from 10 up. */
export const word = (n: number) => WORDS[n] ?? String(n)
/** Returns "Two things" or "One thing". */
export const things = (n: number, what = 'thing') => {
  const w = word(n)
  return `${w[0].toUpperCase()}${w.slice(1)} ${what}${n === 1 ? '' : 's'}`
}
/** Returns the first word of a name. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

// The facts MarshBot's turns are written from (saved on the brief by recheck.service.ts).
export type BriefFacts = {
  site: string
  client: { id: string | null; name: string; reference: string }
  engineerName: string | null
  observations: number
  surveyStart: string | null
  surveyEnd: string | null
  reportDue: string | null
  anotherVisit: boolean
  allDrafted: boolean
  draftedParts: number
  stageDates: Record<Stage, string | null>
  exportedAt: string | null
  exportDay: string | null
  exportFile: { fileName: string; pages: number | null } | null
  hasChecklist: boolean
  evidenceFingerprint: string
  captureStarted: boolean
  categorisedObservations: number
  // Counts for the ticked rows (round 5): client documents, reviewed walks,
  // transcribed recordings, and the observations each reviewed walk created.
  documents: number
  walksReviewed: number
  recordingsTranscribed: number
  walkObservations: Record<string, number>
}
