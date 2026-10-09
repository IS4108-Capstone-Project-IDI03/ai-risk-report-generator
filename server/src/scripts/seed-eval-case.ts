import 'dotenv/config'
import { readFileSync } from 'fs'
import mongoose from 'mongoose'
import { resolve } from 'path'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension, type Severity } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { locationKey } from '../services/location.service'

// An assessment built from one GN-01 eval case (rag-service eval/cases/*.json): the
// observations an engineer would have captured, written from a real Marsh report's
// section. Lets the case be drafted in the app and held next to the report it came
// from. Unlike the eval, the app does not keep that report out of retrieval, so a
// draft may echo it; the eval (judge_sections.py) is the fair comparison.
// Run `npm run seed` first for the accounts, then:
//   npm run seed:case -- office-5-s7-construction
// Re-running resets this assessment's observations, sessions and drafts.
type Case = {
  name: string
  source: string
  assessment: {
    reference: string
    jurisdiction: string
    facility_type: string
    standards: string[]
  }
  observations: {
    id: string
    COPE_dimension: CopeDimension
    severity: Severity
    location: string
    note: string
  }[]
}

async function seed(name: string) {
  const file = resolve(__dirname, '../../../microservices/rag-service/eval/cases', `${name}.json`)
  const c = JSON.parse(readFileSync(file, 'utf8')) as Case
  await connectDb()
  const alex = await UserModel.findOne({ email: 'alex.rowe@example.com' }).lean()
  if (!alex) throw new Error('Run `npm run seed` first: the sample accounts are missing.')

  const reference = `RPT-${c.assessment.reference}`
  const site = await SiteModel.findOneAndUpdate(
    { code: `SITE-${c.assessment.reference}` },
    {
      $set: {
        name: `${c.source.split(',')[0].replace(/\.pdf$/, '')} (eval case)`,
        jurisdiction: c.assessment.jurisdiction,
        facilityType: c.assessment.facility_type,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  // One location per distinct place named in the case.
  const places = [...new Set(c.observations.map((o) => o.location))]
  const assessment = await AssessmentModel.findOneAndUpdate(
    { reference },
    {
      $set: {
        site: site._id,
        client: 'Eval case client',
        surveyType: 'Property risk survey',
        siteVisitDate: new Date('2026-09-28'),
        reportDueDate: new Date('2026-10-16'),
        standards: c.assessment.standards,
        engineer: alex._id,
        locations: places.map((p) => ({ name: p, key: locationKey(p) })),
      },
      $unset: { reportStatus: 1, archivedAt: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )

  // Start this assessment afresh: its evidence, sessions and drafts only.
  await ObservationModel.deleteMany({ assessment: assessment._id })
  await CaptureSessionModel.deleteMany({ assessment: assessment._id })
  await ReportSectionModel.deleteMany({ assessment: assessment._id })
  await ReportOfiModel.deleteMany({ assessment: assessment._id })

  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  for (const [i, o] of c.observations.entries()) {
    await ObservationModel.create({
      assessment: assessment._id,
      session: session._id,
      engineer: alex.name,
      engineerId: alex._id,
      note: o.note,
      recordings: [],
      severity: o.severity,
      location: assessment.locations.find((l) => l.name === o.location)!._id,
      metadata: {
        source_type: 'observation',
        jurisdiction: site.jurisdiction,
        facility_type: site.facilityType,
        COPE_dimension: o.COPE_dimension,
        // A minute apart, in the case's order.
        effective_date: new Date(Date.UTC(2026, 8, 28, 9, i)),
      },
    })
  }
  console.log(
    `${reference} is ready with ${c.observations.length} observations from ${c.source}. ` +
      'Sign in as alex.rowe@example.com and open it > Report generation.',
  )
}

const name = process.argv[2]
if (!name) {
  console.error('Name an eval case, e.g. npm run seed:case -- office-5-s7-construction')
  process.exitCode = 1
} else {
  seed(name)
    .catch((error) => {
      console.error('Eval case seeding failed:', error.message)
      process.exitCode = 1
    })
    .finally(async () => {
      await mongoose.disconnect()
    })
}
