// The already-handled check (F-10 round 3): has someone else dealt with the thing a To do row
// points at? Called by useInboxActions.ts before it opens a row. Calls the two read calls in
// knowledge-base/api.ts; only knowledge request and document rows are ever checked.
import { GatewayError } from '../assessments/api'
import { needsReview } from '../knowledge-base/display'
import { getKnowledgeDocument, getKnowledgeRequest } from '../knowledge-base/api'
import type { Notification } from '../notifications/api'

type Who = { at: string; by: { id: string; name: string } } | null
export type Handled = { title: string; by: { id: string; name: string } | null; at: string | null }

const handled = (title: string, who: Who): Handled => ({
  title,
  by: who?.by ?? null,
  at: who?.at ?? null,
})

// A 404 means the record is gone; any other failure is passed on, so the row opens as usual.
const gone = (error: unknown) => {
  if (error instanceof GatewayError && error.status === 404) return null
  throw error
}

const FAILED_TITLE = {
  queued: 'Document already being retried',
  processing: 'Document already being retried',
  complete: 'Document already retried',
  cancelled: 'Upload already cancelled',
} as const

/** Returns whether this row is one the check reads (the rest open without a call). */
export const isChecked = (n: Notification) => {
  const c = n.context
  if (n.purpose === 'knowledge_gap_request') return !!c?.requestId && !c.status
  return (
    n.purpose === 'ingestion_status' &&
    !!c?.documentId &&
    (c.status === 'needs_review' || c.status === 'failed')
  )
}

/** Resolves to what to tell the person, or null when the row opens as usual; rejects if the check fails. */
export async function alreadyHandled(
  n: Notification,
  signal: AbortSignal,
): Promise<Handled | null> {
  const c = n.context
  if (!c || !isChecked(n)) return null
  if (n.purpose === 'knowledge_gap_request') {
    const r = await getKnowledgeRequest(c.requestId, signal).catch(gone)
    if (!r || r.status === 'open') return null
    return handled(`Request already ${r.status}`, r.closed)
  }
  const d = await getKnowledgeDocument(c.documentId, signal).catch(gone)
  if (!d) return handled('Document already deleted', null)
  if (d.withdrawn) return handled('Document already withdrawn', d.withdrawn)
  if (c.status === 'needs_review') {
    return needsReview(d) ? null : handled('Document already reviewed', d.handled)
  }
  if (d.status === 'failed') return null
  return handled(FAILED_TITLE[d.status], d.handled)
}
