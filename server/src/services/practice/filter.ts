// F-12: the one shared rule that keeps practice assessments out of real work (ADR 0003).
// A practice assessment is a real assessment with `practice` set, plus its own made-up client
// and site. Every query that lists or counts assessments, clients or sites ACROSS records
// spreads NOT_PRACTICE into its filter. Called by every such reader. Calls nothing.

// Practice references use their own prefix and counter, so they never use up an RPT number
// and can be told apart where only the reference is at hand (usage records, notifications).
export const PRACTICE_PREFIX = 'PRACTICE-'

/** The filter that leaves practice records out; spread it into an assessment, client or site query. */
export const NOT_PRACTICE = { practice: { $exists: false } } as const

/** Returns true when this reference names a practice assessment (live or hidden). */
export function isPracticeReference(reference: string | null | undefined): boolean {
  return !!reference && reference.startsWith(PRACTICE_PREFIX)
}
