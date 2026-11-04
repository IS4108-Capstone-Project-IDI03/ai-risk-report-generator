// A document a client sent (CP-23), kept under the whole client, one of its
// sites or one assessment. Written by client-intake-create.service.ts; listed,
// opened and deleted through client-document.service.ts. The original file is
// in S3 at client-documents/<client id>/<document id>.<ext>.
import { Schema, Types, model } from 'mongoose'
import type { IStamp } from './observation.model'

export const PLACEMENT_KINDS = ['client', 'site', 'assessment'] as const

export interface IClientDocument {
  client: Types.ObjectId
  // Where it is listed on the client page: `site` is set for a site's and an
  // assessment's document, `assessment` for an assessment's.
  placement: {
    kind: (typeof PLACEMENT_KINDS)[number]
    site?: Types.ObjectId
    assessment?: Types.ObjectId
  }
  name: string
  contentType: string
  size: number
  // A fingerprint of its bytes; equal fingerprints mean equal files.
  sha256: string
  key: string
  // Who added it and when.
  uploaded: IStamp
  // Where it came from: created from an intake, or uploaded on the client page.
  origin: 'intake' | 'upload'
  metadata: {
    source_type: 'client_document'
    // The placed site's, or null for the whole client.
    jurisdiction: string | null
    facility_type: string | null
    COPE_dimension: null
    // When it was added (CP-40 may add the document's own issue date).
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const documentSchema = new Schema<IClientDocument>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    placement: {
      kind: { type: String, enum: PLACEMENT_KINDS, required: true },
      site: { type: Schema.Types.ObjectId, ref: 'Site' },
      assessment: { type: Schema.Types.ObjectId, ref: 'Assessment' },
    },
    name: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    key: { type: String, required: true },
    origin: { type: String, enum: ['intake', 'upload'], default: 'intake' },
    uploaded: {
      at: { type: Date, required: true },
      by: { id: { type: String, required: true }, name: { type: String, required: true } },
    },
    metadata: {
      source_type: { type: String, enum: ['client_document'], required: true },
      jurisdiction: { type: String, default: null },
      facility_type: { type: String, default: null },
      COPE_dimension: { type: Schema.Types.Mixed, default: null },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'client_documents' },
)

export const ClientDocumentModel = model<IClientDocument>('ClientDocument', documentSchema)
