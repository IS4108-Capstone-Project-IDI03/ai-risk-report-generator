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
  client: string
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
  },
  {
    timestamps: true,
    collection: 'assessments',
  },
)

export const AssessmentModel = model<IAssessment>('Assessment', assessmentSchema)
