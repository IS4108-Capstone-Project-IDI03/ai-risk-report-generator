// The Documents list's filters (KB-01, IN-17). '' means "don't filter" on that field.
// Shared by screens/KnowledgeDocuments.tsx and KnowledgeBase.tsx, which keeps them in
// the history entry for the way back from a Review page.
import type { KnowledgeDocument } from './api'
import { isDraft, needsReview } from './display'

export const NO_FILTERS = {
  title: '',
  sourceType: '',
  jurisdiction: '',
  facilityType: '',
  status: '',
  // How it entered the knowledge base: 'upload' or 'manual' (IN-18).
  entry: '',
}

export type Filters = typeof NO_FILTERS

// Whether a document shows the status badge chosen in the filter; must match
// components/DocumentRow.tsx, where Needs review is never Active (IN-05) and a
// draft is neither (IN-18).
export const hasStatus = (d: KnowledgeDocument, status: string) =>
  status === 'withdrawn'
    ? Boolean(d.withdrawn)
    : status === 'draft'
      ? isDraft(d)
      : status === 'needs_review'
        ? needsReview(d)
        : !d.withdrawn && !isDraft(d) && !needsReview(d)

// A fuzzy title match: the typed letters appear in the title in order, with
// gaps allowed, ignoring case and spaces ("nfpa13" finds "NFPA 13 …").
// ponytail: no typo tolerance; add a fuzzy library if admins ask for it.
export function titleMatches(title: string, query: string) {
  const t = title.toLowerCase()
  let at = 0
  for (const letter of query.toLowerCase().replace(/\s/g, '')) {
    at = t.indexOf(letter, at) + 1
    if (at === 0) return false
  }
  return true
}

/** Returns the documents that pass every filter. */
export const applyFilters = (documents: KnowledgeDocument[], filters: Filters) =>
  documents.filter(
    (d) =>
      titleMatches(d.title, filters.title) &&
      (!filters.sourceType || d.sourceType === filters.sourceType) &&
      (!filters.jurisdiction || d.jurisdiction === filters.jurisdiction) &&
      (!filters.facilityType || d.facilityType === filters.facilityType) &&
      (!filters.status || hasStatus(d, filters.status)) &&
      (!filters.entry || d.entryMethod === filters.entry),
  )
