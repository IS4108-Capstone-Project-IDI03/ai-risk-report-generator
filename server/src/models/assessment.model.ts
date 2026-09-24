import { Schema, Types, model } from 'mongoose'

export interface IAssessment {
  // Human-readable report ID shown in the UI, e.g. RPT-2026-0411. Allocated
  // by the server when the assessment is created.
  reference: string
  site: Types.ObjectId
  client: string
  policyReference?: string
  surveyType: string
  siteVisitDate?: Date
  reportDueDate?: Date
  // Names for now; these become user and document references once accounts
  // (F-04) and the knowledge base exist. The first engineer is the lead.
  standards: string[]
  engineers: string[]
  createdAt: Date
  updatedAt: Date
}

const assessmentSchema = new Schema<IAssessment>(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    site: {
      type: Schema.Types.ObjectId,
      ref: 'Site',
      required: true,
    },
    client: {
      type: String,
      required: true,
      trim: true,
    },
    policyReference: {
      type: String,
      trim: true,
    },
    surveyType: {
      type: String,
      required: true,
      trim: true,
    },
    siteVisitDate: Date,
    reportDueDate: Date,
    standards: {
      type: [String],
      default: [],
    },
    engineers: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'assessments',
  },
)

export const AssessmentModel = model<IAssessment>('Assessment', assessmentSchema)
