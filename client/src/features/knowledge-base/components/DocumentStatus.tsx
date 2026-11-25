// A document's status as the design system's pill (icon + word): Active, Needs review,
// Withdrawn. A manual draft uses StatusPill's Draft. Used by components/DocumentRow.tsx,
// components/ReviewBadge.tsx and screens/ReviewDocument.tsx.
import { STATUS_LOOK, type DocumentStatusKind } from '../documentStatusLook'
import { TonePill } from './TonePill'

/** Returns the status pill for a document. */
export function DocumentStatus({ status }: { status: DocumentStatusKind }) {
  const s = STATUS_LOOK[status]
  return (
    <TonePill tone={s.tone} icon={s.icon}>
      {s.label}
    </TonePill>
  )
}
