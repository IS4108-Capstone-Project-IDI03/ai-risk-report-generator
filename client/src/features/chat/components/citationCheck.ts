// The server's quote check for one answer, shared with its citation markers (CB-01 AC2).
// Unverified is per citation (label + quote): the same words can be right in P1 and wrong in P3.
// The server appends it as the answer's last line (Meta); until then markers show "checking".
import { createContext, useContext } from 'react'

/** Where a passage label points: the document, its pages and whether it's withdrawn. */
export type CitedSource = {
  label: string
  documentId: string
  passageId?: string
  pageStart?: number
  pageEnd?: number
  withdrawn?: boolean
}

/** `described`: unverified citations whose words are only in a picture's AI description (KB-02). */
export type CitationCheck = {
  sources: Map<string, CitedSource>
  unverified: Set<string>
  described?: Set<string>
} | null

export const CitationCheckContext = createContext<CitationCheck>(null)

/** Returns the lookup key for one citation: its passage label and quoted words together. */
export const checkKey = (label: string, quote: string) => `${label}\u0000${quote}`

/** A citation's check: no result yet, found in the document, only in a picture's AI
 * description (KB-02: cited, but never the document's words), or not found. */
export type CitationState = 'checking' | 'verified' | 'described' | 'unverified'

/** Returns a citation's source and state. */
export function useCitationCheck(
  passage: string,
  quote: string,
): { source?: CitedSource; state: CitationState } {
  const check = useContext(CitationCheckContext)
  if (!check) return { source: undefined, state: 'checking' }
  const source = check.sources.get(passage)
  const key = checkKey(passage, quote)
  // A label the model invented has no source, so it can't be verified either.
  if (!source) return { source, state: 'unverified' }
  if (!check.unverified.has(key)) return { source, state: 'verified' }
  return { source, state: check.described?.has(key) ? 'described' : 'unverified' }
}

// Each citation's number in its answer, keyed by checkKey(label, quote), in order of first citation.
export const CitationNumbersContext = createContext<Map<string, number>>(new Map())
