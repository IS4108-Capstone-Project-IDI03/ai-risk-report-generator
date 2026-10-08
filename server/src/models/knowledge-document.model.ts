import { Schema, model } from 'mongoose'

// Where a knowledge document is in ingestion. The gateway sets `queued`; the
// ingestion worker moves it on (see microservices/ingestion-service/app/worker.py).
export const INGESTION_STATUSES = ['queued', 'processing', 'complete', 'failed'] as const
export type IngestionStatus = (typeof INGESTION_STATUSES)[number]

export const SOURCE_TYPES = ['fm_standard', 'nfpa_standard', 'marsh_report'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

// One earlier version of a document's details (KB-01 AC9), kept when a
// correction replaces them.
export interface IDocumentVersion {
  title: string
  issuingBody: string | null
  edition?: string
  metadata: IKnowledgeDocument['metadata']
  replacedAt: Date
  replacedBy: { id: string; name: string }
}

// The six details auto-labelling reads from a file (IN-05), snake_case as in
// the ingestion service's /label answer and the Chroma labels.
export const DETAIL_NAMES = [
  'source_type',
  'title',
  'edition',
  'effective_date',
  'jurisdiction',
  'facility_type',
] as const
export type DetailName = (typeof DETAIL_NAMES)[number]

// What labelling found for one detail. `source` becomes 'admin' when someone
// saves a correction (KB-01).
export interface ILabelledDetail {
  value: unknown
  confidence?: number | null
  evidence?: { page: number; quote: string } | null
  model?: string | null
  source: 'auto' | 'admin'
}

export interface IKnowledgeDocument {
  title: string
  // Set from the source type (FM Global, NFPA or Marsh); null while the
  // source type is Unconfirmed.
  issuingBody: string | null
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
  // Present on every document (see CLAUDE.md). A whole standard spans every
  // facility type and COPE dimension until chunk-level tagging exists. A
  // detail labelling could not confirm (IN-05) is null: an approved exception
  // to the CLAUDE.md rule, like an observation's COPE_dimension null.
  metadata: {
    source_type: SourceType | null
    jurisdiction: string | null
    facility_type: string | null
    COPE_dimension: 'all'
    effective_date: Date | null
  }
  // Details still Unconfirmed (snake_case names). Non-empty = "needs review".
  // The worker reads it to give passages `needs_review`.
  unconfirmed: DetailName[]
  // What auto-labelling found per detail, kept as evidence (IN-05). Absent when
  // labelling failed at upload and no one has saved a correction yet.
  labelling?: {
    labelledAt: Date
    details: Partial<Record<DetailName, ILabelledDetail>>
  }
  // Earlier versions of the details above, oldest first.
  history: IDocumentVersion[]
  // Present only while the document is withdrawn (KB-01): when, and by whom.
  // `status` stays `complete`; reinstating removes this.
  withdrawn?: { at: Date; by: { id: string; name: string } }
  // Times an admin has pressed Retry on a failed ingestion. Only ever bumped by
  // retryIngestion, so it counts human retries, not automatic worker re-runs.
  // Not shown anywhere; its sole use is to make each retry's ingestion
  // notification distinct (so a repeat failure notifies again, IN-10).
  retryCount: number
  createdAt: Date
  updatedAt: Date
}

const metadataSchema = {
  source_type: { type: String, enum: [...SOURCE_TYPES, null] },
  jurisdiction: String,
  facility_type: String,
  COPE_dimension: { type: String, enum: ['all'], required: true },
  effective_date: Date,
}

// One detail's labelling record. `value` is Mixed because details differ in type.
const labelledDetailSchema = new Schema(
  {
    value: Schema.Types.Mixed,
    confidence: Number,
    evidence: { type: new Schema({ page: Number, quote: String }, { _id: false }) },
    model: String,
    source: { type: String, enum: ['auto', 'admin'], required: true },
  },
  { _id: false },
)

const knowledgeDocumentSchema = new Schema<IKnowledgeDocument>(
  {
    title: { type: String, required: true, trim: true },
    issuingBody: { type: String, trim: true },
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
    metadata: metadataSchema,
    unconfirmed: { type: [String], default: [] },
    labelling: {
      type: new Schema(
        {
          labelledAt: { type: Date, required: true },
          details: new Schema(
            Object.fromEntries(DETAIL_NAMES.map((name) => [name, labelledDetailSchema])),
            { _id: false },
          ),
        },
        { _id: false },
      ),
    },
    history: {
      type: [
        new Schema<IDocumentVersion>(
          {
            title: { type: String, required: true },
            issuingBody: String,
            edition: String,
            metadata: metadataSchema,
            replacedAt: { type: Date, required: true },
            replacedBy: {
              id: { type: String, required: true },
              name: { type: String, required: true },
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    withdrawn: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          by: {
            id: { type: String, required: true },
            name: { type: String, required: true },
          },
        },
        { _id: false },
      ),
    },
    retryCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'knowledge_documents' },
)

export const KnowledgeDocumentModel = model<IKnowledgeDocument>(
  'KnowledgeDocument',
  knowledgeDocumentSchema,
)
