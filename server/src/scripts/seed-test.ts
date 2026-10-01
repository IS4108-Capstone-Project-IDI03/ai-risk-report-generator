import 'dotenv/config'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { connectDb } from '../models/db'
import { SiteModel } from '../models/site.model'
import { locationKey } from '../services/location.service'
import { UserModel, type IUser } from '../models/user.model'

// Dev-only default password for every seeded account (F-04). Never used
// outside local/CI seeding — real accounts set their own via F-06.
const SEED_PASSWORD = 'password123'

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
    role: 'risk_engineer',
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

  // F-05 keeps two roles. Accounts saved as the retired `reviewer` role
  // become risk engineers, whose permissions covered everything it had.
  // The raw collection, because the schema no longer admits `reviewer`.
  const retired = await UserModel.collection.updateMany(
    { role: 'reviewer' },
    { $set: { role: 'risk_engineer' } },
  )
  if (retired.modifiedCount)
    console.log(`${retired.modifiedCount} reviewer account(s) are now risk engineers.`)

  // Inserted only when missing, so re-seeding keeps edits made on screen.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)
  for (const user of SAMPLE_USERS) {
    await UserModel.updateOne(
      { staffId: user.staffId },
      { $setOnInsert: { ...user, active: true, passwordHash } },
      { upsert: true },
    )
    // Accounts seeded before sign-in existed (F-03) have no password yet;
    // give them the dev one, without touching a password already set.
    await UserModel.updateOne(
      { staffId: user.staffId, passwordHash: { $exists: false } },
      { $set: { passwordHash } },
    )
  }
  console.log(`${SAMPLE_USERS.length} sample user accounts are available.`)

  // Assigns a sample assessment to one account by its staff ID (RV-10).
  async function assignedTo(staffId: string) {
    const user = (await UserModel.findOne({ staffId }).lean())!
    return { engineerIds: [user._id], engineers: [user.name] }
  }

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
        ...(await assignedTo('MRE-0001')),
      },
    },
    { upsert: true },
  )
  // The places the client's demo lists, added only once so ones added on screen stay.
  await AssessmentModel.updateOne(
    { reference: 'RPT-2026-0411', 'locations.0': { $exists: false } },
    {
      $set: {
        locations: [
          { name: 'Bay 3 — north aisle', floor: 'Ground' },
          { name: 'Bay 1 — despatch', floor: 'Ground' },
          { name: 'Pump house' },
          { name: 'Office annexe', floor: 'Level 1' },
          { name: 'External yard' },
          { name: 'Sprinkler valve room', floor: 'Ground' },
        ].map((l) => ({ ...l, key: locationKey(l.name, l.floor) })),
      },
    },
  )
  console.log('Sample assessment RPT-2026-0411 is available.')

  // Two more for the work list (RV-10), with reports at later stages so the
  // status filter and site/client search have something to narrow.
  const extras = [
    {
      reference: 'RPT-2026-0408',
      site: { code: 'SYN-UK-LCS', name: 'Leeds Cold Store', facilityType: 'Cold store' },
      client: 'Fennick Foods',
      siteVisitDate: '2026-04-08',
      lead: 'MRE-0001',
      reportStatus: 'under_review',
    },
    {
      reference: 'RPT-2026-0327',
      site: { code: 'SYN-IE-DW4', name: 'Dublin Warehouse 4', facilityType: 'Warehouse' },
      client: 'Northgate Logistics',
      siteVisitDate: '2026-03-20',
      lead: 'MRE-0002',
      reportStatus: 'finalised',
    },
  ]
  for (const { site, siteVisitDate, lead, ...assessment } of extras) {
    const stored = await SiteModel.findOneAndUpdate(
      { code: site.code },
      { $set: { ...site, jurisdiction: site.code.slice(4, 6) } },
      { upsert: true, returnDocument: 'after' },
    )
    await AssessmentModel.updateOne(
      { reference: assessment.reference },
      {
        $set: {
          ...assessment,
          site: stored._id,
          surveyType: 'Property risk survey',
          siteVisitDate: new Date(siteVisitDate),
          ...(await assignedTo(lead)),
        },
      },
      { upsert: true },
    )
  }
  console.log('Work list assessments RPT-2026-0408 and RPT-2026-0327 are available.')
}

seedAndVerify()
  .catch((error) => {
    console.error('MongoDB verification failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
