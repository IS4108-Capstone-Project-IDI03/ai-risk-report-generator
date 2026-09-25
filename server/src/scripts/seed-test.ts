import 'dotenv/config'
import mongoose from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { connectDb } from '../models/db'
import { SiteModel } from '../models/site.model'
import { UserModel, type IUser } from '../models/user.model'

// Sample accounts for the user accounts screen (F-03). Synthetic people with
// example.com emails; names echo the engineers in the client's demo data.
type SampleUser = Pick<IUser, 'staffId' | 'name' | 'email' | 'role' | 'jobTitle' | 'office'>
const SAMPLE_USERS: SampleUser[] = [
  {
    staffId: 'MRE-0001',
    name: 'Alex Rowe',
    email: 'alex.rowe@example.com',
    role: 'risk_engineer',
    jobTitle: 'Senior risk engineer · Property',
    office: 'UK',
  },
  {
    staffId: 'MRE-0002',
    name: 'Jide Okafor',
    email: 'jide.okafor@example.com',
    role: 'risk_engineer',
    jobTitle: 'Risk engineer · Property',
    office: 'SG',
  },
  {
    staffId: 'MRE-0003',
    name: 'Mira Haas',
    email: 'mira.haas@example.com',
    role: 'reviewer',
    jobTitle: 'Technical reviewer · Business interruption',
    office: 'SG',
  },
  {
    staffId: 'MRE-0004',
    name: 'Sana Patel',
    email: 'sana.patel@example.com',
    role: 'knowledge_admin',
    jobTitle: 'Consultant · Natural hazards',
    office: 'MY',
  },
]

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

  // Inserted only when missing, so re-seeding keeps edits made on screen.
  for (const user of SAMPLE_USERS) {
    await UserModel.updateOne(
      { staffId: user.staffId },
      { $setOnInsert: { ...user, active: true } },
      { upsert: true },
    )
  }
  console.log(`${SAMPLE_USERS.length} sample user accounts are available.`)
}

seedAndVerify()
  .catch((error) => {
    console.error('MongoDB verification failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
