import { Schema, Types, model } from 'mongoose'

// Report progress once a report exists. Before that, an assessment's status is
// derived from its capture session (see assessment.service.ts), not stored.
export const REPORT_STATUSES = ['draft', 'under_review', 'finalised'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

// A place on the site the engineer records observations in, e.g. "Stairwell B"
// on "Level 2". Added by the engineer during capture.
export interface ILocation {
  _id: Types.ObjectId
  name: string
  floor?: string
  // Lowercased name and floor, so "stairwell b" on "level 2" is the same place.
  key: string
}

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
  // Display snapshots; engineerIds are the assignment identity, first is lead.
  standards: string[]
  engineers: string[]
  engineerIds: Types.ObjectId[]
  reportStatus?: ReportStatus
  locations: ILocation[]
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
    engineerIds: { type: [Schema.Types.ObjectId], ref: 'User', default: undefined, index: true },
    reportStatus: {
      type: String,
      enum: REPORT_STATUSES,
    },
    // Embedded: a short list, always read with its assessment.
    locations: [
      {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        floor: { type: String, trim: true, maxlength: 40 },
        key: { type: String, required: true },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'assessments',
  },
)

export const AssessmentModel = model<IAssessment>('Assessment', assessmentSchema)
