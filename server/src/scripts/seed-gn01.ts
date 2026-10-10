import 'dotenv/config'
import { readFileSync } from 'fs'
import mongoose, { Types } from 'mongoose'
import { join } from 'path'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { connectDb } from '../models/db'
import {
  copeDimensionsOf,
  ObservationModel,
  type CopeDimension,
  type IRecording,
  type Severity,
} from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { locationKey } from '../services/location.service'
import { putObject } from '../services/storage.service'

// Sample data for trying report section drafting (GN-01): a Singapore office
// whose observations exercise sections 7-12. The notes are written as they are
// on site (terse, abbreviated, some dictated), so a draft has to turn them into
// report prose rather than copy them. Run `npm run seed` first for the
// accounts, then this. Re-running resets this one assessment's observations,
// capture sessions and drafts, so every test starts from the same evidence.
// Sign in as alex.rowe@example.com and open RPT-2026-0901 > Report generation.
// Section 9 Fire Protection is the richest: its FM-200 observations match the
// FM-200 manual in the knowledge base. Section 10 has no evidence on purpose.
// Some observations carry voice recordings (spoken audio in `seed-audio/`,
// made with macOS `say`), uploaded to S3 with their transcript already filled
// in, so no Whisper call is made. One shows a failed transcription.
const REFERENCE = 'RPT-2026-0901'

const LOCATIONS = {
  server: { name: 'Main server room', floor: 'Level 5' },
  riser: { name: 'Electrical riser B', floor: 'Level 3' },
  pumps: { name: 'Fire pump room', floor: 'Basement 1' },
  fcc: { name: 'Fire command centre', floor: 'Level 1' },
}

const OBSERVATIONS: {
  at: keyof typeof LOCATIONS
  cope: CopeDimension | null
  severity: Severity
  note?: string
  standard?: string
  // A file in seed-audio/, with its transcript, or the error a failed attempt left.
  recording?: { file: string; transcript?: string; error?: string }
}[] = [
  {
    at: 'server',
    cope: 'Protection',
    severity: 'low',
    standard: 'FM-200 Design and Installation Manual',
    note: 'FM200 total flood in main server rm L5. 2x 80L cyls in store next door. svc tag - last 6mthly svc Apr 26, cert sighted.',
  },
  {
    at: 'server',
    cope: 'Protection',
    severity: 'high',
    standard: 'NFPA 2001',
    note: 'cable tray pens thru ceiling void above srv rm not sealed. asked for door fan / room integrity test report - none available.',
  },
  {
    at: 'server',
    cope: 'Protection',
    severity: 'moderate',
    recording: {
      file: 'exit-door',
      transcript:
        "ok so at the server room exit door there's the manual release and the abort switch, signs are up, and the discharge delay is set to thirty seconds",
    },
  },
  {
    at: 'pumps',
    cope: 'Protection',
    severity: 'critical',
    note: 'wet pipe spk all office flrs + bsmt carpark. B1 spk CV found SHUT!! not chained, no tamper switch.',
    recording: {
      file: 'b1-valve',
      transcript:
        "just to add on the B1 valve, the facilities manager said it was shut two weeks ago for a pipe repair and nobody opened it back up. they've opened it now while I was there",
    },
  },
  {
    at: 'pumps',
    cope: 'Protection',
    severity: 'low',
    note: '2 fire pumps (1 elec, 1 diesel) off 300m3 spk tank. weekly churn logs up to date. annual flow test Mar 26.',
  },
  {
    at: 'fcc',
    cope: 'Protection',
    severity: 'low',
    note: 'FCC - addressable FA panel, monitored by central stn co.',
    recording: {
      file: 'fcc-panel',
      error: 'Whisper could not transcribe the recording: the audio was cut off.',
    },
  },
  {
    at: 'riser',
    cope: 'Construction',
    severity: 'high',
    note: '20 storey RC frame, glass curtain wall. elec riser B L3 - cable pens not fire stopped',
  },
  {
    at: 'server',
    cope: 'Occupancy',
    severity: 'moderate',
    recording: {
      file: 'ups-room',
      transcript:
        "so the UPS is lithium ion, it's in the room right next to the server room, only a drywall partition between them and nobody could tell me the fire rating",
    },
  },
  // Uncategorised, so drafting must leave it out (CP-02 AC4).
  {
    at: 'fcc',
    cope: null,
    severity: 'low',
    note: 'contractor hot work on roof, no permit displayed',
  },
]

async function seed() {
  await connectDb()
  const alex = await UserModel.findOne({ email: 'alex.rowe@example.com' }).lean()
  if (!alex) throw new Error('Run `npm run seed` first: the sample accounts are missing.')

  const site = await SiteModel.findOneAndUpdate(
    { code: 'SYN-SG-MBO' },
    {
      $set: {
        name: 'Marina Bay Office Tower (GN-01 sample)',
        jurisdiction: 'SG',
        facilityType: 'Office',
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  const assessment = await AssessmentModel.findOneAndUpdate(
    { reference: REFERENCE },
    {
      $set: {
        site: site._id,
        client: 'GN-01 Sample Client',
        surveyType: 'Property risk survey',
        siteVisitDate: new Date('2026-09-28'),
        reportDueDate: new Date('2026-10-16'),
        standards: ['FM-200 Design and Installation Manual', 'NFPA 2001'],
        engineer: alex._id,
        locations: Object.values(LOCATIONS).map((l) => ({
          ...l,
          key: locationKey(l.name, l.floor),
        })),
      },
      $unset: { reportStatus: 1, archivedAt: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )

  // Start this sample afresh: its evidence, sessions and drafts only.
  await ObservationModel.deleteMany({ assessment: assessment._id })
  await CaptureSessionModel.deleteMany({ assessment: assessment._id })
  await ReportSectionModel.deleteMany({ assessment: assessment._id })

  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  const locationId = (at: keyof typeof LOCATIONS) =>
    assessment.locations.find((l) => l.name === LOCATIONS[at].name)!._id
  for (const [i, o] of OBSERVATIONS.entries()) {
    const effectiveDate = new Date(Date.UTC(2026, 8, 28, 9, i))
    const id = new Types.ObjectId()
    const recordings: IRecording[] = []
    if (o.recording) {
      // Same key shape as a real capture (observation.service.ts), so the
      // audio route streams it back from S3.
      const recordingId = new Types.ObjectId()
      const key = `audio/${REFERENCE}/${id}/${recordingId}.m4a`
      const audio = readFileSync(join(__dirname, 'seed-audio', `${o.recording.file}.m4a`))
      await putObject(key, audio, 'audio/x-m4a')
      const { transcript, error } = o.recording
      recordings.push({
        _id: recordingId,
        name: 'Recording 1',
        key,
        contentType: 'audio/x-m4a',
        size: audio.length,
        transcription: {
          status: error ? ('failed' as const) : ('transcribed' as const),
          transcript,
          error,
          attempts: [{ startedAt: effectiveDate, finishedAt: effectiveDate, error }],
        },
      })
    }
    await ObservationModel.create({
      _id: id,
      assessment: assessment._id,
      session: session._id,
      engineer: alex.name,
      engineerId: alex._id,
      note: o.note,
      recordings,
      standard: o.standard,
      severity: o.severity,
      location: locationId(o.at),
      metadata: {
        source_type: 'observation',
        jurisdiction: site.jurisdiction,
        facility_type: site.facilityType,
        COPE_dimension: copeDimensionsOf(o.cope),
        // The site visit, a minute apart in the order they are listed here.
        effective_date: effectiveDate,
      },
    })
  }
  console.log(
    `${REFERENCE} is ready with ${OBSERVATIONS.length} observations. Sign in as ` +
      'alex.rowe@example.com and open it > Report generation.',
  )
}

seed()
  .catch((error) => {
    console.error('GN-01 sample seeding failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
