// Counts the drafted evidence sections that cite a standard (GN-16 AC5).
// Called by components/StandardsBanner.tsx.
import type { ReviewSection } from './api'
import { inDraft } from './reviewDisplay'

/** The share of drafted sections that should cite a standard, in %. Fixed: there is no setting for it. */
export const STANDARD_CITE_TARGET = 50

const EVIDENCE = new Set(['7', '8', '9', '10', '11', '12'])

/** Returns how many drafted sections 7-12 cite a standard (not a past report), and how many are drafted. */
export function countCitingStandard(sections: ReviewSection[]): { cited: number; total: number } {
  const drafted = sections.filter((s) => EVIDENCE.has(s.id) && s.draft)
  const cited = drafted.filter((s) =>
    s.draft!.subsections.some((sub) =>
      sub.statements
        .filter(inDraft)
        .some((st) => st.citations.some((id) => s.sources[id]?.kind === 'standard')),
    ),
  )
  return { cited: cited.length, total: drafted.length }
}
