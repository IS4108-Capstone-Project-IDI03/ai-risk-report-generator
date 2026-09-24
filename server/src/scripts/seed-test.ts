import 'dotenv/config'
import mongoose from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { connectDb } from '../models/db'
import { SiteModel } from '../models/site.model'

async function seedAndVerify(): Promise<void> {
  await connectDb()

  await SiteModel.updateOne(
    { code: 'SYN-SG-001' },
    {
      $set: {
        name: 'Synthetic Singapore Warehouse',
        jurisdiction: 'SG',
        facilityType: 'Warehouse',
      },
    },
    {
      upsert: true,
    },
  )

  const record = await SiteModel.findOne({
    code: 'SYN-SG-001',
  })
    .select('code name jurisdiction facilityType -_id')
    .lean()

  if (!record) {
    throw new Error('Test record was written but could not be read back')
  }

  console.log('MongoDB test record read successfully:', record)

  // Sample assessment for the capture screen (CP-01). Matches the client's
  // demo assessment, so live and demo views name the same site.
  const tilbury = await SiteModel.findOneAndUpdate(
    { code: 'SYN-UK-TDC' },
    {
      $set: {
        name: 'Tilbury Distribution Centre',
        address: 'Ferry Lane, Tilbury RM18 7HR',
        jurisdiction: 'UK',
        facilityType: 'Distribution warehouse',
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  await AssessmentModel.updateOne(
    { reference: 'RPT-2026-0411' },
    {
      $set: {
        site: tilbury._id,
        client: 'Northgate Logistics',
        surveyType: 'Property risk survey',
        siteVisitDate: new Date('2026-04-11'),
        reportDueDate: new Date('2026-04-25'),
        standards: ['FM Global 2-0', 'NFPA 13'],
        engineers: ['A. Rowe'],
      },
    },
    { upsert: true },
  )
  console.log('Sample assessment RPT-2026-0411 is available.')
}

seedAndVerify()
  .catch((error) => {
    console.error('MongoDB verification failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
