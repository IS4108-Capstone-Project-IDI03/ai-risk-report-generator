import { Schema, model } from 'mongoose'

// Where a knowledge document is in ingestion. The gateway sets `queued`; the
// ingestion worker moves it on (see microservices/ingestion-service/app/worker.py).
export const INGESTION_STATUSES = ['queued', 'processing', 'complete', 'failed'] as const
export type IngestionStatus = (typeof INGESTION_STATUSES)[number]

export const SOURCE_TYPES = ['fm_standard', 'nfpa_standard', 'marsh_report'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export interface IKnowledgeDocument {
  title: string
  // Set from the source type (FM Global, NFPA or Marsh).
  issuingBody: string
  // A standard's year, e.g. "2022"; absent for a past report.
  edition?: string
  // The name the file had on the admin's machine.
  fileName: string
  // The unaltered original in S3. MongoDB holds only its key; sha256 lets
  // anyone confirm a retrieved copy matches what was uploaded.
  file: { key: string; contentType: 'application/pdf'; size: number; sha256: string }
  status: IngestionStatus
  // Why ingestion failed, shown to the admin.
  error?: string
  result?: { chunksIndexed: number; tablesCaptured: number; imagesCaptured: number }
  startedAt?: Date
  finishedAt?: Date
  // Required on every document (see CLAUDE.md). A whole standard spans every
  // facility type and COPE dimension until chunk-level tagging exists.
  metadata: {
    source_type: SourceType
    jurisdiction: string
    facility_type: string
    COPE_dimension: 'all'
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const knowledgeDocumentSchema = new Schema<IKnowledgeDocument>(
  {
    title: { type: String, required: true, trim: true },
    issuingBody: { type: String, required: true, trim: true },
    edition: { type: String, trim: true },
    fileName: { type: String, required: true },
    file: {
      key: { type: String, required: true },
      contentType: { type: String, enum: ['application/pdf'], required: true },
      size: { type: Number, required: true },
      sha256: { type: String, required: true },
    },
    status: { type: String, enum: INGESTION_STATUSES, required: true },
    error: String,
    result: { chunksIndexed: Number, tablesCaptured: Number, imagesCaptured: Number },
    startedAt: Date,
    finishedAt: Date,
    metadata: {
      source_type: { type: String, enum: SOURCE_TYPES, required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: String, enum: ['all'], required: true },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'knowledge_documents' },
)

export const KnowledgeDocumentModel = model<IKnowledgeDocument>(
  'KnowledgeDocument',
  knowledgeDocumentSchema,
)
