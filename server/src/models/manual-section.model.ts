import { Schema, model, type Types } from 'mongoose'

// One clause of a manually entered standard (IN-18). This collection is the
// source of truth for its text: the passages in Chroma are rebuilt from it when
// a clause is saved or re-embedded (ingestion-service app/manual.py).
//
// No labels here (an exception to the five-field rule, like passages): a
// clause's source_type, jurisdiction, facility_type and effective_date are its
// document's, in `knowledge_documents`, and its COPE_dimension is none, as for
// every knowledge document (see docs/areas/database.md).

export const MANUAL_IMAGE_KINDS = ['table', 'formula', 'picture'] as const
export type ManualImageKind = (typeof MANUAL_IMAGE_KINDS)[number]

export interface IManualSection {
  documentId: Types.ObjectId
  // The clause's fixed number in its document, from `knowledge_documents.manualSeq`;
  // never reused or changed. Passage ids are `<documentId>:<seq>[:part<n>]`, so
  // moving a clause leaves its citations alone.
  seq: number
  // Its place in the list, in steps of 10 so a clause fits between two others.
  order: number
  // The clause number as typed ("8.6.1"), spaces collapsed; unique in its document.
  clause: string
  // The heading trail, outermost first.
  headings: string[]
  text: string
  // Screenshots of tables, formulas and figures: the S3 key, what it shows, and
  // the text OCR read from it as the admin corrected it.
  images: { key: string; kind: ManualImageKind; text: string }[]
  // Whether its passages are in the search index as saved. False until the first
  // successful save, and after one whose embedding failed (`indexError` says why).
  indexed: boolean
  indexError?: string
  // Whether an admin has saved it for this edition. A clause copied from an
  // earlier edition is unchecked until then, and Publish waits for it (IN-18).
  checked: boolean
  // Where a copied clause came from, for the editor's note only. Citation and
  // delete checks never read it.
  copiedFrom?: { documentId: Types.ObjectId; clause: string }
  updatedBy: { id: string; name: string }
  createdAt: Date
  updatedAt: Date
}

const manualSectionSchema = new Schema<IManualSection>(
  {
    documentId: { type: Schema.Types.ObjectId, required: true },
    seq: { type: Number, required: true, min: 1 },
    order: { type: Number, required: true, min: 0 },
    clause: { type: String, required: true, trim: true },
    headings: { type: [String], default: [] },
    text: { type: String, required: true },
    images: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            kind: { type: String, enum: MANUAL_IMAGE_KINDS, required: true },
            text: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    indexed: { type: Boolean, required: true, default: false },
    indexError: String,
    checked: { type: Boolean, required: true, default: false },
    copiedFrom: {
      type: new Schema(
        {
          documentId: { type: Schema.Types.ObjectId, required: true },
          clause: { type: String, required: true },
        },
        { _id: false },
      ),
    },
    updatedBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
  },
  { timestamps: true, collection: 'manual_sections' },
)

// A clause number appears once per document (IN-18): a second "8.6.1" is a typo
// to fix, not a second clause. The race guard behind the gateway's own check.
manualSectionSchema.index({ documentId: 1, clause: 1 }, { unique: true })
// Each fixed number is given once per document.
manualSectionSchema.index({ documentId: 1, seq: 1 }, { unique: true })

export const ManualSectionModel = model<IManualSection>('ManualSection', manualSectionSchema)
