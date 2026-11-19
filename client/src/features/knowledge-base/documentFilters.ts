// The Documents list's filters (KB-01, IN-17). '' means "don't filter" on that field.
// Shared by screens/KnowledgeDocuments.tsx and KnowledgeBase.tsx, which keeps them in
// the history entry for the way back from a Review page.
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
