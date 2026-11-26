// A document's status as the design system's pill (icon + word): Active, Needs review,
// Withdrawn. A manual draft uses StatusPill's Draft. Used by components/DocumentRow.tsx,
// components/DocumentDetails.tsx and screens/ReviewDocument.tsx.
import { StatusPill } from '../../../design-system'
import { PILL_KEY, type DocumentStatusKind } from '../documentStatusLook'

/** Returns the status pill for a document. */
export function DocumentStatus({ status }: { status: DocumentStatusKind }) {
  return <StatusPill status={PILL_KEY[status]} />
}
