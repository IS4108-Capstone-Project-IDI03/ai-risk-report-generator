// Checks for the note-taking settings (CP-35), run before anything is sent.
// Called by screens/NoteTakingSection and components/GlossaryEditor. Must match the gateway's rules
// (server settings service): codes 1-8 letters or digits, all different; glossary 1-30 / 1-120, max 200.
import type { GlossaryEntry, NoteCodes } from './api'

export const MAX_GLOSSARY = 200
export const DEFAULT_CODES: NoteCodes = { fact: 'F', info_request: 'IR', recommendation: 'REC' }

/** Returns the plain problem with the three codes, or '' when they can be sent. */
export function codeProblem(codes: NoteCodes): string {
  const list = Object.values(codes).map((c) => c.trim())
  if (list.some((c) => !/^[A-Za-z0-9]{1,8}$/.test(c)))
    return 'Each code needs 1 to 8 letters or digits.'
  if (new Set(list.map((c) => c.toLowerCase())).size < list.length)
    return 'Two types cannot share a code.'
  return ''
}

/** Returns the plain problem with a new glossary entry, or '' when it can be added. */
export function glossaryProblem(entry: GlossaryEntry, existing: GlossaryEntry[]): string {
  const term = entry.term.trim()
  const meaning = entry.meaning.trim()
  if (!term || term.length > 30) return 'The term needs 1 to 30 characters.'
  if (!meaning || meaning.length > 120) return 'The meaning needs 1 to 120 characters.'
  if (existing.some((g) => g.term.toLowerCase() === term.toLowerCase()))
    return 'That term is already in your glossary.'
  if (existing.length >= MAX_GLOSSARY) return `The glossary holds up to ${MAX_GLOSSARY} terms.`
  return ''
}
