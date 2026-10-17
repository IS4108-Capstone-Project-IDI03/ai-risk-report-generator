import { Schema, Types, model } from 'mongoose'

// Report progress once a report exists. Before that, an assessment's status is
// derived from its capture session (see assessment.service.ts), not stored.
export const REPORT_STATUSES = ['draft', 'under_review', 'finalised'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

// A place on the site the engineer records observations in (CP-16): in a
// building, e.g. "Staircase" on "Level 2" of "Block A" (the level is optional,
// for the whole building, e.g. its facade), or elsewhere on site, with a name
// only, e.g. "Fire access route". Added by the engineer during capture. One
// saved before CP-16 may have a floor but no building.
export interface ILocation {
  _id: Types.ObjectId
  building?: string
  name: string
  // Its level, shown as Level.
  floor?: string
  // Lowercased name, floor and building, so "staircase" on "level 2" of
  // "block a" is the same place. See locationKey.
  key: string
}

export interface IAssessment {
  // Human-readable report ID shown in the UI, e.g. RPT-2026-0411. Allocated
  // by the server when the assessment is created.
  reference: string
  site: Types.ObjectId
  // The client's name as typed before CP-17. Unused once its site has a
  // client (npm run migrate:clients), and kept so that can be run again; a new
  // assessment has none, and reads its client through its site.
  client?: string
  surveyType: string
  siteVisitDate?: Date
  reportDueDate?: Date
  // The one assigned engineer's account; their name is read from it, so a
  // rename shows everywhere. The work list matches on it (RV-10).
  engineer?: Types.ObjectId
  reportStatus?: ReportStatus
  // Set when the engineer archives the assessment (RV-10 AC8): a soft delete
  // that hides it from the work list and keeps everything it holds.
  archivedAt?: Date
  locations: ILocation[]
  // Appendix A's photos (GN-07), in report order, each one of its observations'
  // photos with the caption shown under it. See appendix.service.ts.
  appendixPhotos: { photo: Types.ObjectId; caption: string }[]
  // Section 4's category scores (GN-03), entered by the engineer; the rating is
  // computed from them on read. See risk-quality.service.ts.
  riskQuality?: {
    categories: { category: string; current: number | null; potential: number | null }[]
    updatedAt: Date
    // Who saved them: the engineer's user _id.
    updatedBy: Types.ObjectId
  }
  // Section 5's values, % damage and outage months (GN-03), validated by
  // lossEstimatesSchema before saving; losses are computed on read. See
  // loss-estimate.service.ts.
  lossEstimates?: { inputs: unknown; updatedAt: Date; updatedBy: Types.ObjectId }
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
      trim: true,
    },
    surveyType: {
      type: String,
      required: true,
      trim: true,
    },
    siteVisitDate: Date,
    reportDueDate: Date,
    engineer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    reportStatus: {
      type: String,
      enum: REPORT_STATUSES,
    },
    archivedAt: Date,
    // Embedded: a short list, always read with its assessment.
    locations: [
      {
        building: { type: String, trim: true, maxlength: 100 },
        name: { type: String, required: true, trim: true, maxlength: 100 },
        floor: { type: String, trim: true, maxlength: 40 },
        key: { type: String, required: true },
      },
    ],
    // Embedded for the same reason: a short list, always read with its assessment.
    appendixPhotos: [
      {
        _id: false,
        photo: { type: Schema.Types.ObjectId, required: true },
        caption: { type: String, trim: true, maxlength: 200, default: '' },
      },
    ],
    riskQuality: {
      categories: [{ _id: false, category: String, current: Number, potential: Number }],
      updatedAt: Date,
      updatedBy: Schema.Types.ObjectId,
    },
    // Mixed: nested rows whose shape lossEstimatesSchema already checks.
    lossEstimates: {
      inputs: Schema.Types.Mixed,
      updatedAt: Date,
      updatedBy: Schema.Types.ObjectId,
    },
  },
  {
    timestamps: true,
    collection: 'assessments',
  },
)

export const AssessmentModel = model<IAssessment>('Assessment', assessmentSchema)
