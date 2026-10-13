// The server's quote check for one answer, shared with its citation markers (CB-01 AC2).
// Unverified is per citation (label + quote): the same words can be right in P1 and wrong in P3.
// The server appends it as the answer's last line (Meta); until then markers show "checking".
import { createContext, useContext } from 'react'

/** Where a passage label points: the document, its pages and whether it's withdrawn. */
export type CitedSource = {
  label: string
  documentId: string
  pageStart?: number
  pageEnd?: number
  withdrawn?: boolean
}

export type CitationCheck = { sources: Map<string, CitedSource>; unverified: Set<string> } | null

export const CitationCheckContext = createContext<CitationCheck>(null)

/** Returns the lookup key for one citation: its passage label and quoted words together. */
export const checkKey = (label: string, quote: string) => `${label}\u0000${quote}`

/** Returns a citation's source and state: checking (no result yet), verified or unverified. */
export function useCitationCheck(passage: string, quote: string) {
  const check = useContext(CitationCheckContext)
  if (!check) return { source: undefined, state: 'checking' as const }
  const source = check.sources.get(passage)
  // A label the model invented has no source, so it can't be verified either.
  const verified = source && !check.unverified.has(checkKey(passage, quote))
  return { source, state: verified ? ('verified' as const) : ('unverified' as const) }
}

// Each passage label's number in its answer, in order of first citation (1, 2, 3…).
export const CitationNumbersContext = createContext<Map<string, number>>(new Map())
