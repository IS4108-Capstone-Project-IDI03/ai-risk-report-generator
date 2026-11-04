// A client intake (CP-23): the documents an engineer adds to start a new
// assessment from, kept for 24 hours while the form is read and reviewed.
// Written by client-intake.service.ts and client-intake-create.service.ts;
// the daily cleanup job deletes expired ones and their files.
import { Schema, Types, model } from 'mongoose'

// uploaded -> reading -> ready (or failed, which can be read again) ->
// creating (claimed by one Create at a time) -> created.
export const INTAKE_STATUSES = [
  'uploaded',
  'reading',
  'ready',
  'failed',
  'creating',
  'created',
] as const
export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

// accepted on upload; read or failed once its text was asked for.
export const INTAKE_FILE_STATUSES = ['accepted', 'read', 'failed'] as const

export interface IIntakeFile {
  _id: Types.ObjectId
  name: string
  contentType: string
  // Its type read from its bytes: pdf, docx, doc, msg or eml.
  ext: string
  size: number
  // A fingerprint of its bytes; equal fingerprints mean equal files.
  sha256: string
  // In S3, under client-intakes/<intake id>/.
  key: string
  status: (typeof INTAKE_FILE_STATUSES)[number]
  // Why it could not be read, in plain English.
  reason: string | null
}

export interface IClientIntake {
  engineer: Types.ObjectId
  files: IIntakeFile[]
  // Email text pasted rather than saved as a file.
  pastedText?: string
  status: IntakeStatus
  // rag-service's proposal in camelCase, as the read route returns it.
  result: unknown
  // The documents whose text was read, with their names, so a source quote
  // can name the attachment it came from.
  sources: { documentId: string; name: string; fileId: string | null }[]
  // An email's attachments that couldn't be read (a .doc, damaged, empty),
  // with the reason, listed as failed files after their email (AC4).
  failedAttachments: { fileId: string; name: string; size: number; reason: string }[]
  // What Create made, kept so a repeat creates nothing twice (as a site walk's).
  created?: {
    clientId?: string
    siteIds?: Record<string, string>
    assessmentIds?: Record<string, string>
    // By file id.
    documentIds?: Record<string, string>
  }
  expiresAt: Date
  metadata: {
    source_type: 'client_intake'
    // None until the records are created (docs/areas/database.md).
    jurisdiction: null
    facility_type: null
    COPE_dimension: null
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const intakeSchema = new Schema<IClientIntake>(
  {
    engineer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    files: [
      {
        name: { type: String, required: true },
        contentType: { type: String, required: true },
        ext: { type: String, required: true },
        size: { type: Number, required: true },
        sha256: { type: String, required: true },
        key: { type: String, required: true },
        status: { type: String, enum: INTAKE_FILE_STATUSES, required: true },
        reason: { type: String, default: null },
      },
    ],
    pastedText: String,
    status: { type: String, enum: INTAKE_STATUSES, required: true, default: 'uploaded' },
    result: { type: Schema.Types.Mixed, default: null },
    sources: { type: Schema.Types.Mixed, default: [] },
    failedAttachments: { type: Schema.Types.Mixed, default: [] },
    created: { type: Schema.Types.Mixed },
    // Read by the daily cleanup job (client-intake.service.ts).
    expiresAt: { type: Date, required: true, index: true },
    metadata: {
      source_type: { type: String, enum: ['client_intake'], required: true },
      jurisdiction: { type: Schema.Types.Mixed, default: null },
      facility_type: { type: Schema.Types.Mixed, default: null },
      COPE_dimension: { type: Schema.Types.Mixed, default: null },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'client_intakes', minimize: false },
)

export const ClientIntakeModel = model<IClientIntake>('ClientIntake', intakeSchema)
