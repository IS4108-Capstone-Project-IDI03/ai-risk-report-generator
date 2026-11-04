// Turns the assessment types saved before CP-23 into its three visit types:
// a "Property risk survey" is the site's First survey when no assessment there
// came before it (by visit date, else when it was made), and a Resurvey
// otherwise; "Business interruption" and "Natural hazard review" become
// Resurvey. Any other value is left as it is.
// Safe to run more than once: a converted assessment is skipped.
//   npm --prefix server run migrate:visit-types
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { AssessmentModel } from '../models/assessment.model'

const LEGACY = ['Property risk survey', 'Business interruption', 'Natural hazard review']

/** Converts the legacy assessment types; returns how many became First surveys and Resurveys. */
export async function migrateVisitTypes() {
  const sites = await AssessmentModel.distinct('site', { surveyType: { $in: LEGACY } })
  let firstSurveys = 0
  let resurveys = 0
  for (const site of sites) {
    const all = await AssessmentModel.find({ site }, 'surveyType siteVisitDate createdAt').lean()
    const when = (a: (typeof all)[number]) => (a.siteVisitDate ?? a.createdAt).getTime()
    all.sort((a, b) => when(a) - when(b) || a.createdAt.getTime() - b.createdAt.getTime())
    for (const [i, a] of all.entries()) {
      if (!LEGACY.includes(a.surveyType)) continue
      const first = i === 0 && a.surveyType === 'Property risk survey'
      // Matching on the old value means a run alongside another changes it once.
      const { modifiedCount } = await AssessmentModel.updateOne(
        { _id: a._id, surveyType: a.surveyType },
        { $set: { surveyType: first ? 'First survey' : 'Resurvey' } },
      )
      if (first) firstSurveys += modifiedCount
      else resurveys += modifiedCount
    }
  }
  return { firstSurveys, resurveys }
}

async function migrate() {
  await connectDb()
  const result = await migrateVisitTypes()
  console.log(`First surveys: ${result.firstSurveys}. Resurveys: ${result.resurveys}.`)
  await mongoose.disconnect()
}

// Run from the command line; a test imports migrateVisitTypes alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
