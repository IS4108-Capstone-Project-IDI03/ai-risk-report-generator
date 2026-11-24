// Demo data for the Comparison tab (RV-13): a cold store client with four
// visits to one site, so comparing an assessment with the previous report for
// the same site can be shown from start to end with realistic names.
// - RPT-2026-9101, First survey, 5 Jan 2026, finalised, one observation and no
//   findings: the oldest report, for the report picker and "No earlier
//   finalised report" (its own Comparison tab).
// - RPT-2026-9102, Resurvey, 2 Mar 2026, finalised: the previous report. Six
//   observations, drafted Sections 7 to 10 whose findings cite them, and two
//   accepted OFIs. Its Section 9 says "7.5 bar", for the figure.
// - RPT-2026-9103, Resurvey, 20 Nov 2026, not finalised: the assessment to
//   compare. Eight observations written to give each outcome: Worse (with a
//   figure), Sources disagree, Improved, Fixed, Unchanged, New, a shutter
//   listed apart, and nothing about the roller shutter's test (Not checked).
// - RPT-2026-9104, Resurvey, 22 Nov 2026, no observations: Compare greyed out.
// `npm run seed:comparison` adds it, `npm run seed:comparison:remove` removes
// only it. Run by hand; never by the app or tests. Needs `npm run seed` first
// (Alex's account). No AI call: the drafts and OFIs are written as if drafted.
//
// Everything it adds hangs off a fixed client id and its site, SITE-9101.
// Adding removes the earlier run first: every assessment at that site (one
// created there while trying it too) with its observations, drafts, OFIs and
// comparisons. Removing never touches anything at another site.
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ClientModel } from '../models/client.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension, type Severity } from '../models/observation.model'
import { ReportComparisonModel } from '../models/report-comparison.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { clientKey } from '../services/client.service'
import { locationKey } from '../services/location.service'
import { draftingEvidence } from '../services/section.service'

const CLIENT = {
  _id: new Types.ObjectId('c0c0a0000000000000009101'),
  name: 'Kestrel Frozen Foods',
}
const SITE = {
  code: 'SITE-9101',
  name: 'Tuas Cold Store',
  address: '10 Tuas South Avenue 2, Singapore 637601',
  jurisdiction: 'SG',
  facilityType: 'Cold store',
}
const on = (iso: string) => new Date(iso + 'T00:00:00.000Z')
const TEMPLATE_VERSION = 'global-pre-v2.0-2026-02'

// The places on site, as the location picker lists them.
type Place = 'office' | 'pump' | 'valves' | 'yard' | 'plant' | 'store' | 'dock'
const PLACES: Record<Place, { name: string; floor?: string; building?: string }> = {
  office: { name: 'Office', floor: 'Ground', building: 'Block A' },
  pump: { name: 'Pump room', floor: 'Basement 1', building: 'Block A' },
  valves: { name: 'Sprinkler valve room', floor: 'Ground', building: 'Block A' },
  yard: { name: 'Yard' },
  plant: { name: 'Plant room', floor: 'Level 1', building: 'Block A' },
  store: { name: 'Cold store', floor: 'Level 1', building: 'Block A' },
  dock: { name: 'Loading bay', floor: 'Ground', building: 'Block A' },
}

type Seen = { id: string; at: Place; cope: CopeDimension; severity: Severity; note: string }
type Visit = {
  ref: string
  type: 'First survey' | 'Resurvey'
  visited: Date
  due: Date
  finalised: boolean
  places: Place[]
  seen: Seen[]
}

const VISITS: Visit[] = [
  {
    ref: '01',
    type: 'First survey',
    visited: on('2026-01-05'),
    due: on('2026-01-20'),
    finalised: true,
    places: ['office'],
    seen: [
      {
        id: 'A0',
        at: 'office',
        cope: 'Occupancy',
        severity: 'low',
        note: 'Office block on the ground floor of Block A.',
      },
    ],
  },
  {
    ref: '02',
    type: 'Resurvey',
    visited: on('2026-03-02'),
    due: on('2026-03-20'),
    finalised: true,
    places: ['office', 'pump', 'valves', 'yard', 'plant', 'store'],
    seen: [
      {
        id: 'A1',
        at: 'pump',
        cope: 'Protection',
        severity: 'high',
        note: 'Fire pump churn pressure 7.5 bar at the weekly test. Diesel tank kept full.',
      },
      {
        id: 'A2',
        at: 'valves',
        cope: 'Protection',
        severity: 'moderate',
        note: 'Sprinkler control valve V-2 chained but not locked.',
      },
      {
        id: 'A3',
        at: 'yard',
        cope: 'Exposure',
        severity: 'high',
        note: 'Combustible pallets stored within 5 m of the north wall.',
      },
      {
        id: 'A4',
        at: 'plant',
        cope: 'Construction',
        severity: 'low',
        note: 'Fire door to the plant room was wedged open with an extinguisher.',
      },
      {
        id: 'A5',
        at: 'store',
        cope: 'Construction',
        severity: 'low',
        note: 'Roller shutter in the fire wall between the cold store and dispatch closes on test.',
      },
      {
        id: 'A6',
        at: 'store',
        cope: 'Occupancy',
        severity: 'moderate',
        note: 'Cold store holds palletised frozen food in plastic wrap, racked to 9 m.',
      },
    ],
  },
  {
    ref: '03',
    type: 'Resurvey',
    visited: on('2026-11-20'),
    due: on('2026-12-04'),
    finalised: false,
    places: ['office', 'pump', 'valves', 'yard', 'plant', 'store', 'dock'],
    seen: [
      {
        id: 'B1',
        at: 'pump',
        cope: 'Protection',
        severity: 'critical',
        note: 'Fire pump churn pressure 6.9 bar at the weekly test; diesel tank half full.',
      },
      {
        id: 'B2',
        at: 'valves',
        cope: 'Protection',
        severity: 'moderate',
        note: 'Valve V-2 locked open with a padlock.',
      },
      {
        id: 'B3',
        at: 'valves',
        cope: 'Protection',
        severity: 'high',
        note: 'Valve V-2 found chained again on the afternoon check; padlock missing.',
      },
      {
        id: 'B4',
        at: 'yard',
        cope: 'Exposure',
        severity: 'low',
        note: 'No combustible storage within 10 m of the building.',
      },
      {
        id: 'B5',
        at: 'plant',
        cope: 'Construction',
        severity: 'low',
        note: 'Fire door to the plant room closes and latches; no wedge.',
      },
      {
        id: 'B6',
        at: 'store',
        cope: 'Occupancy',
        severity: 'moderate',
        note: 'Cold store still racked to 9 m with palletised frozen food in plastic wrap.',
      },
      {
        id: 'B7',
        at: 'dock',
        cope: 'Protection',
        severity: 'high',
        note: 'Hose reel cabinet blocked by stock.',
      },
      {
        id: 'B8',
        at: 'store',
        cope: 'Construction',
        severity: 'low',
        note: 'A shutter on the east side was not tested on this visit.',
      },
    ],
  },
  {
    ref: '04',
    type: 'Resurvey',
    visited: on('2026-11-22'),
    due: on('2026-12-06'),
    finalised: false,
    places: ['office', 'pump', 'valves', 'yard', 'plant', 'store'],
    seen: [],
  },
]

// The previous report's drafted sections: every part of the template in its
// order, with findings only where the report says something. Each finding
// cites the observations it rests on, by their id above.
type Part = { heading: string; kind: 'narrative' | 'fields' | 'table' }
type Finding = { text: string; cites: string[] }
const n = (heading: string): Part => ({ heading, kind: 'narrative' })
const f = (heading: string): Part => ({ heading, kind: 'fields' })
const t = (heading: string): Part => ({ heading, kind: 'table' })
const SECTIONS: {
  id: string
  title: string
  cope: CopeDimension
  parts: Part[]
  findings: Record<string, Finding[]>
}[] = [
  {
    id: '7',
    title: 'Construction',
    cope: 'Construction',
    parts: [
      n('Construction Narrative'),
      t('Construction Table'),
      n('Compartmentalization and Fire Divisions'),
      n('Details on Combustible Construction'),
    ],
    findings: {
      'Compartmentalization and Fire Divisions': [
        {
          text: 'The roller shutter in the fire wall between the cold store and dispatch closed fully when tested.',
          cites: ['A5'],
        },
        {
          text: 'The fire door to the plant room was wedged open with a fire extinguisher.',
          cites: ['A4'],
        },
      ],
    },
  },
  {
    id: '8',
    title: 'Occupancy, Hazards, and Utilities',
    cope: 'Occupancy',
    parts: [
      f('Occupancy'),
      n('Overview'),
      n('Key Processes'),
      n('Key Machinery'),
      f('Special Hazards'),
      f('Power'),
      n('Back-up Power'),
      t('Transformer details'),
      n('Boilers'),
      n('Refrigeration / Chillers / Cooling towers'),
      n('Fuels and energy supplies'),
      n('Process water'),
      n('Compressed air'),
      n('Compressed gases'),
      n('Waste and effluent treatment'),
      n('Other site services'),
    ],
    findings: {
      Overview: [
        {
          text: 'The cold store holds palletised frozen food in plastic wrap, racked to 9 m.',
          cites: ['A6'],
        },
      ],
    },
  },
  {
    id: '9',
    title: 'Fire Protection',
    cope: 'Protection',
    parts: [
      t('Automatic Sprinkler Protection'),
      n('Automatic Sprinkler Protection Comments'),
      n('Special Extinguishing Systems'),
      n('Water Supply Details'),
      t('Water Supply Test Results'),
      n('Water Supply Test Comments'),
      t('Fire / Booster Pump Details'),
      n('Fire / Booster Pump Comments'),
      t('Pump Flow Test Data'),
      n('Pump Flow Test Comments'),
      f('Manual Firefighting Features'),
      n('Other Manual Firefighting Comments'),
      n('Fire Alarm Monitoring'),
      f('Fire Alarm Details'),
    ],
    findings: {
      'Automatic Sprinkler Protection Comments': [
        { text: 'Sprinkler control valve V-2 was chained but not locked.', cites: ['A2'] },
      ],
      'Fire / Booster Pump Comments': [
        {
          text: 'The fire pump churn pressure was 7.5 bar at the weekly test, and the diesel tank was kept full.',
          cites: ['A1'],
        },
      ],
    },
  },
  {
    id: '10',
    title: 'External Exposures',
    cope: 'Exposure',
    parts: [t('Location Details'), f('Boundary Exposures'), f('Natural Catastrophe Exposures')],
    findings: {
      'Boundary Exposures': [
        {
          text: 'North: Combustible pallets were stored within 5 m of the north wall.',
          cites: ['A3'],
        },
      ],
    },
  },
]

// The previous report's accepted OFIs, as Section 3 lists them.
const OFIS = [
  {
    title: 'Lock Sprinkler Control Valves Open',
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description:
      'Lock every sprinkler control valve in the open position and check the locks weekly.',
    observation: 'Sprinkler control valve V-2 was chained but not locked.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Procedural',
    priority: 'Priority 1',
    cites: ['A2'],
  },
  {
    title: 'Keep a Clear Zone Around the Building',
    category: 'Management Programs',
    type: 'Housekeeping',
    description: 'Keep combustible storage at least 10 m from the building walls.',
    observation: 'Combustible pallets were stored within 5 m of the north wall.',
    likelihood: 'Possible',
    consequence: 'Moderate',
    effort: 'Minor Procedural',
    priority: 'Priority 2',
    cites: ['A3'],
  },
]

const PROVENANCE = {
  provider: 'seed',
  model: 'seed-fixture',
  effort: 'none',
  prompt_version: 'seed',
}
const reference = (visit: Visit) => `RPT-2026-91${visit.ref}`

async function remove() {
  // Only the demo's own site, found by its code and the demo client: a real
  // assessment that happens to share a reference elsewhere is never touched.
  const site = await SiteModel.findOne({ code: SITE.code, client: CLIENT._id }, '_id').lean()
  const assessments = site ? await AssessmentModel.find({ site: site._id }, '_id').lean() : []
  const ids = assessments.map((a) => a._id)
  await Promise.all([
    ObservationModel.deleteMany({ assessment: { $in: ids } }),
    ReportOfiModel.deleteMany({ assessment: { $in: ids } }),
    ReportSectionModel.deleteMany({ assessment: { $in: ids } }),
    ReportComparisonModel.deleteMany({ assessment: { $in: ids } }),
    CaptureSessionModel.deleteMany({ assessment: { $in: ids } }),
  ])
  // The review log (RV-02) and the editor's versions (RV-08) are append-only
  // through their models; the demo's drafts are gone, so whatever was decided or
  // saved on them while trying it goes too, through the driver, as
  // seed-eval-case.ts resets a sample.
  await ReviewAuditModel.collection.deleteMany({ assessment: { $in: ids } })
  await ReportSectionVersionModel.collection.deleteMany({ assessment: { $in: ids } })
  await AssessmentModel.deleteMany({ _id: { $in: ids } })
  if (site) await SiteModel.deleteOne({ _id: site._id })
  await ClientModel.deleteMany({ _id: CLIENT._id })
  return ids.length
}

async function add() {
  const alex = await UserModel.findOne({ staffId: 'MRE-0001' }).lean()
  if (!alex) throw new Error('Run `npm run seed` first: Alex (MRE-0001) is missing.')
  await remove()
  // Its references, site code and client name must be free: a clash means real
  // data has them, which this script must not change.
  const [references, code, name] = await Promise.all([
    AssessmentModel.find({ reference: { $in: VISITS.map(reference) } }, 'reference').lean(),
    SiteModel.exists({ code: SITE.code }),
    ClientModel.exists({ key: clientKey(CLIENT.name) }),
  ])
  const taken = [
    ...references.map((a) => a.reference),
    ...(code ? [SITE.code] : []),
    ...(name ? [CLIENT.name] : []),
  ]
  if (taken.length)
    throw new Error(`Already used by other data, so nothing was added: ${taken.join(', ')}.`)
  await ClientModel.create({ ...CLIENT, key: clientKey(CLIENT.name), division: 'Cold chain' })
  const site = await SiteModel.create({ ...SITE, client: CLIENT._id })
  const metadata = { jurisdiction: SITE.jurisdiction, facility_type: SITE.facilityType }

  const made: Record<string, string> = {}
  for (const visit of VISITS) {
    // Each visit's own copy of the site's places, as a new assessment copies them.
    const locations = visit.places.map((p) => ({
      _id: new Types.ObjectId(),
      ...PLACES[p],
      key: locationKey(PLACES[p].name, PLACES[p].floor, PLACES[p].building),
    }))
    const at = (p: Place) => locations[visit.places.indexOf(p)]._id
    const assessment = await AssessmentModel.create({
      reference: reference(visit),
      site: site._id,
      surveyType: visit.type,
      siteVisitDate: visit.visited,
      reportDueDate: visit.due,
      engineer: alex._id,
      locations,
      ...(visit.finalised && { reportStatus: 'finalised' }),
    })
    made[visit.ref] = assessment.reference
    if (!visit.seen.length) continue
    const session = await CaptureSessionModel.create({
      assessment: assessment._id,
      status: visit.finalised ? 'ready_for_generation' : 'active',
    })
    const saved = await ObservationModel.insertMany(
      visit.seen.map((o, i) => ({
        assessment: assessment._id,
        session: session._id,
        engineer: alex.name,
        engineerId: alex._id,
        note: o.note,
        recordings: [],
        severity: o.severity,
        location: at(o.at),
        metadata: {
          source_type: 'observation',
          ...metadata,
          COPE_dimension: [o.cope],
          effective_date: visit.visited,
        },
        // A minute apart on the visit day, so they list in the order written.
        createdAt: new Date(visit.visited.getTime() + (9 * 60 + i) * 60_000),
      })),
    )
    const idOf = new Map(visit.seen.map((o, i) => [o.id, String(saved[i]._id)]))
    if (visit.ref !== '02') continue

    // The previous report: drafts holding today's evidence, so none reads as out of date.
    const evidence = await draftingEvidence(assessment.reference)
    for (const s of SECTIONS) {
      await ReportSectionModel.create({
        assessment: assessment._id,
        sectionId: s.id,
        title: s.title,
        subsections: s.parts.map((part) => ({
          ...part,
          statements:
            part.kind === 'table'
              ? []
              : (s.findings[part.heading] ?? []).map((finding) => ({
                  text: finding.text,
                  citations: finding.cites.map((id) => `O:${idOf.get(id)}`),
                  supported: true,
                })),
        })),
        sources: {},
        questions: [],
        evidence,
        guardrail: { passed: true, unsupported_count: 0 },
        provenance: {
          ...PROVENANCE,
          template_version: TEMPLATE_VERSION,
          generated_at: visit.visited,
        },
        createdBy: alex._id,
        metadata: {
          source_type: 'report_section',
          ...metadata,
          COPE_dimension: s.cope,
          effective_date: visit.visited,
        },
      })
    }
    await ReportOfiModel.insertMany(
      OFIS.map(({ cites, ...o }) => ({
        ...o,
        assessment: assessment._id,
        state: 'accepted',
        acceptedAt: visit.visited,
        acceptedBy: alex._id,
        observations: cites.map((id) => idOf.get(id)),
        standards: [],
        precedent: null,
        sources: {},
        provenance: {
          ...PROVENANCE,
          config_version: 'seed',
          generated_at: visit.visited,
        },
        createdBy: alex._id,
        metadata: {
          source_type: 'ofi',
          ...metadata,
          COPE_dimension: 'all',
          effective_date: visit.visited,
        },
      })),
    )
  }
  return made
}

async function main() {
  await connectDb()
  if (process.argv.includes('--remove')) {
    console.log(`Removed the comparison demo: ${await remove()} assessments.`)
  } else {
    const made = await add()
    console.log(
      `Added the comparison demo at ${SITE.name} (${CLIENT.name}): ${made['01']} and ${made['02']} ` +
        `finalised, ${made['03']} to compare, ${made['04']} with no observations. ` +
        `Sign in as Alex Rowe, open ${made['03']} and its Comparison tab.`,
    )
  }
  await mongoose.disconnect()
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
