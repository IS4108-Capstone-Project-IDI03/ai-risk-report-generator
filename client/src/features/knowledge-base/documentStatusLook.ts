// Each document status's word, icon and colour, read from the design system's StatusPill: the
// status pill (components/DocumentStatus.tsx) and the Status filter's options
// (components/DocumentToolbar.tsx) wear the same ones.
import { statusLook } from '../../design-system'

export type DocumentStatusKind = 'active' | 'needs_review' | 'withdrawn'

// The StatusPill key for each status (StatusPill.tsx: document_active, needs_review, withdrawn).
export const PILL_KEY: Record<DocumentStatusKind, string> = {
  active: 'document_active',
  needs_review: 'needs_review',
  withdrawn: 'withdrawn',
}

export const STATUS_LOOK = Object.fromEntries(
  (Object.keys(PILL_KEY) as DocumentStatusKind[]).map((kind) => {
    const { label, icon, fg } = statusLook(PILL_KEY[kind])
    return [kind, { label, icon, fg }]
  }),
) as Record<DocumentStatusKind, { label: string; icon: string; fg: string }>
