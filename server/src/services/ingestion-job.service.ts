// Reads ingestion progress for knowledge documents (E2). The ingestion worker
// the gateway reads it here while a document is `processing`.
// Called by knowledge-document.service.ts.
import { isValidObjectId } from 'mongoose'
import { IngestionJobModel, type IIngestionJob } from '../models/ingestion-job.model'

/**
 * Returns the job for one document, or null if none exists or the id is
 * malformed. A malformed id never throws — callers pass through whatever the
 * document carries.
 */
export async function getJobProgress(documentId: string): Promise<IIngestionJob | null> {
  if (!isValidObjectId(documentId)) return null
  return IngestionJobModel.findOne({ documentId }).lean()
}

/**
 * Returns a map of documentId (string) → job for a batch of ids, in a single
 * query. Missing jobs are simply absent from the map; malformed ids are
 * skipped. Used by listKnowledgeDocuments to avoid one query per document.
 */
export async function getJobProgressBatch(
  documentIds: string[],
): Promise<Map<string, IIngestionJob>> {
  const ids = documentIds.filter(isValidObjectId)
  if (ids.length === 0) {
    return new Map()
  }
  const jobs = await IngestionJobModel.find({ documentId: { $in: ids } }).lean()
  return new Map(jobs.map((job) => [String(job.documentId), job]))
}
