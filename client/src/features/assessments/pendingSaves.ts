// Edits still being saved, for an export to wait on (EX-01 AC1): the
// document editor's next save, or Appendix A's queue of captions and order.
// Each screen with work in flight registers how to finish it; exporting
// saves them all first, and does not export if one fails.
type Flush = () => Promise<boolean>

const flushes = new Set<Flush>()

// Registers a save to finish; returns a function that removes it again.
export function registerPendingSave(flush: Flush): () => void {
  flushes.add(flush)
  return () => {
    flushes.delete(flush)
  }
}

// Finishes every pending save: true once all are saved, false if one failed.
export async function savePendingEdits(): Promise<boolean> {
  const results = await Promise.all([...flushes].map((flush) => flush().catch(() => false)))
  return results.every(Boolean)
}
