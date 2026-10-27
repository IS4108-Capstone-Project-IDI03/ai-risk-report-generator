import 'dotenv/config'
import { writeFileSync } from 'fs'
import mongoose from 'mongoose'
import { resolve } from 'path'
import { connectDb } from '../models/db'
import { FACILITY_TYPES, listApplicableStandards } from '../services/knowledge-document.service'

// The standards in scope for each facility type, for the checklist eval (CP-30
// AC12, rag-service eval/score_checklist.py). The eval talks to S4 alone, and
// the passages in Chroma carry no standard numbers, so it takes them from here:
// the same list the Checklist tab offers. Run, then move the file:
//   npm run export:checklist-cases -- <out.json> [country, default SG]
// e.g. locally, from server/:
//   npm run export:checklist-cases -- ../microservices/rag-service/eval/checklist_cases.json
async function main() {
  const [out = 'checklist_cases.json', country = 'SG'] = process.argv.slice(2)
  await connectDb()
  const cases: Record<string, object[]> = {}
  for (const facilityType of FACILITY_TYPES) {
    cases[facilityType] = (await listApplicableStandards(facilityType, country)).map((d) => ({
      id: d.id,
      title: d.title,
      source_type: d.sourceType,
      standard_number: d.standardNumber,
    }))
  }
  writeFileSync(resolve(out), JSON.stringify({ country, standards: cases }, null, 2) + '\n')
  console.log(`Wrote the standards for ${FACILITY_TYPES.length} facility types to ${resolve(out)}.`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
