// Gives every assessment its MarshBot stage (AS-06), worked out once from its
// data, with its brief: a re-check of each, archived ones included so they have
// a stage if restored. No AI runs: wording waits until an Overview opens.
// Safe to run more than once: a stage only ever moves forward.
//   npm --prefix server run migrate:stages
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { AssessmentModel } from '../models/assessment.model'
import { refreshBrief } from '../services/assistant/recheck.service'

/** Re-checks every assessment; returns how many got a brief. */
export async function migrateStages(): Promise<number> {
  const all = await AssessmentModel.find({}, 'reference').lean()
  let checked = 0
  // One at a time: each re-check reads several collections and rag-service.
  for (const { reference } of all) if (await refreshBrief(reference)) checked++
  return checked
}

async function migrate() {
  await connectDb()
  console.log(`Assessments given a stage: ${await migrateStages()}.`)
  await mongoose.disconnect()
}

// Run from the command line; a test imports migrateStages alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
