// Demo data for the CP-29 Insights tab: one client with five sites, repeat
// visits, observations of every severity and category, accepted OFIs and
// Section 4 scores, so every block of the tab has something to show.
// `npm run seed:cp29` adds it, `npm run seed:cp29:remove` removes only it.
// Run by hand; never by the app or tests. Needs `npm run seed` first (Alex's
// account).
//
// Everything it adds is recognisable: a fixed id for the client, and a DEMO29-
// prefix on site codes and assessment references. Adding removes the earlier
// run's rows first, so running it twice leaves one copy; removing never touches
// anything else.
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ClientInsightSummaryModel } from '../models/client-insight-summary.model'
import { ClientModel } from '../models/client.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension, type Severity } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { clientKey } from '../services/client.service'
import { locationKey } from '../services/location.service'
import { RQR_CATEGORIES } from '../services/risk-quality.service'

const PREFIX = 'DEMO29-'
const CLIENT = {
  _id: new Types.ObjectId('c29c00000000000000000001'),
  name: 'Harbourline Logistics',
}

const day = (offset: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offset)
  return d
}
const on = (iso: string) => new Date(iso + 'T00:00:00.000Z')

type Category = 'C' | 'O' | 'P' | 'E' | 'U'
const COPE: Record<Category, CopeDimension[] | null> = {
  C: ['Construction'],
  O: ['Occupancy'],
  P: ['Protection'],
  E: ['Exposure'],
  U: null,
}
type Level = 'c' | 'h' | 'm' | 'l'
const SEVERITY: Record<Level, Severity> = { c: 'critical', h: 'high', m: 'moderate', l: 'low' }

// What an observation says, by category: [where on site, the note]. Taken in
// turn, so each visit reads differently.
const NOTES: Record<Category, [string, string][]> = {
  C: [
    [
      'Warehouse, Level 1',
      'Fire wall between the dispatch hall and the store has an unsealed cable opening about 300 mm wide.',
    ],
    [
      'Mezzanine',
      'Mezzanine deck is combustible chipboard on unprotected steel, with no sprinklers beneath it.',
    ],
    [
      'Plant room',
      'Insulated wall panels around the plant room have an exposed polystyrene core at two cut edges.',
    ],
    ['Roof', 'Roof lights are cracked over the east bays and held with tape.'],
    [
      'Loading dock',
      'Dock canopy steelwork shows impact damage at column D4; no assessment on file.',
    ],
  ],
  O: [
    [
      'Racking, Aisle 6',
      'Pallets of aerosols are stored in general racking outside the caged area.',
    ],
    ['Packing line', 'Idle timber pallets are stacked 3 m high between the packing lines.'],
    ['Workshop', 'Hot work is carried out in the workshop without a permit on display.'],
    ['Chilled store', 'Shrink-wrap and cardboard waste is kept in the aisle overnight.'],
    ['Dispatch hall', 'Forklift traffic shares the pedestrian route to the fire exit at door 7.'],
  ],
  P: [
    ['Sprinkler valve room', 'Sprinkler control valve is open but not locked or supervised.'],
    ['Racking, Aisle 2', 'Storage reaches within 300 mm of the sprinkler heads in two bays.'],
    [
      'Office block',
      'Fire alarm panel shows a zone fault for the mezzanine that has not been cleared.',
    ],
    ['Warehouse, Level 1', 'Three hose reels are obstructed by stacked pallets.'],
    [
      'Fire pump house',
      'Diesel fire pump fuel tank is at a quarter; the last test record is two months old.',
    ],
    ['Gatehouse', 'Extinguishers in the gatehouse are a year past their service date.'],
  ],
  E: [
    [
      'Yard, east boundary',
      'Timber pallets are stored against the boundary fence within 5 m of the building.',
    ],
    ['Car park', 'Neighbouring unit stores gas cylinders along the shared boundary.'],
    ['Yard', 'Surface water drain by the dock is blocked; ponding reported after heavy rain.'],
  ],
  U: [
    ['Yard', 'Photo of the yard taken for reference; to be described later.'],
    ['Office block', 'Site manager mentioned a planned extension next year.'],
  ],
}

// The findings the summary should be able to name: the same one at three sites,
// and the two that make Tilbury the worst.
const CHARGING: [string, string][] = [
  [
    'Battery charging bay',
    'Shrink-wrapped pallets are stored within 1 m of the forklift chargers along the east wall.',
  ],
  [
    'Charging area, loading dock',
    'Cardboard and timber pallets are stacked beside the forklift chargers.',
  ],
  [
    'Level 1 charging bay',
    'Empty cartons are kept against the charger enclosure; no clear zone is marked.',
  ],
]
const VALVE: [string, string] = [
  'High-bay racking, Aisle 14',
  'In-rack sprinkler valve for aisles 12 to 16 was found closed and untagged. The site could not say when it was shut.',
]
const PUMP: [string, string] = [
  'Fire pump house',
  'Weekly churn test log has no entries after 14 July. The diesel pump started on demand during the visit.',
]
const AMMONIA: [string, string] = [
  'Ammonia plant room',
  'Ammonia detection is now installed with a beacon and a remote alarm; the last function test was three weeks ago.',
]

type Spot = `${Category}${Level}` | [`${Category}${Level}`, [string, string]]
type Visit = {
  ref: string
  type: 'First survey' | 'Resurvey' | 'Follow-up visit'
  visited: Date
  due: Date
  status: 'capturing' | 'ready' | 'draft' | 'under_review' | 'finalised'
  spots: Spot[]
  // Accepted OFIs by priority, and Section 4's score out of 10 for every category.
  ofis: number[]
  score: number | null
}
type Site = {
  code: string
  name: string
  address: string
  jurisdiction: string
  facility: string
  visits: Visit[]
}

const SITES: Site[] = [
  {
    code: 'S1',
    name: 'Tilbury Distribution Centre',
    address: '4 Dock Road, Tilbury RM18 7EH',
    jurisdiction: 'UK',
    facility: 'Distribution warehouse',
    visits: [
      {
        ref: '01',
        type: 'First survey',
        visited: on('2025-03-12'),
        due: on('2025-04-02'),
        status: 'finalised',
        spots: ['Pc', 'Ph', 'Ph', 'Oh', 'Ch', 'Pm', 'Ol', 'Cl', 'El'],
        ofis: [1, 2, 3, 3],
        score: 5.3,
      },
      {
        ref: '02',
        type: 'Resurvey',
        visited: on('2026-09-18'),
        due: day(5),
        status: 'under_review',
        spots: [
          ['Pc', VALVE],
          'Pc',
          ['Ph', PUMP],
          'Ph',
          'Pm',
          'Pl',
          'Pl',
          'Oc',
          ['Oh', CHARGING[0]],
          'Om',
          'Ol',
          'Ch',
          'Cm',
          'El',
        ],
        ofis: [1, 1, 2, 2, 3, 3],
        score: 4.9,
      },
    ],
  },
  {
    code: 'S2',
    name: 'Leeds Cold Store',
    address: '18 Cross Green Way, Leeds LS9 0PS',
    jurisdiction: 'UK',
    facility: 'Cold store',
    visits: [
      {
        ref: '03',
        type: 'First survey',
        visited: on('2025-06-04'),
        due: on('2025-06-25'),
        status: 'finalised',
        spots: ['Pc', 'Oc', 'Ph', 'Ph', 'Ph', 'Oh', 'Oh', 'Ch', 'Ch', 'Pl', 'Ol', 'El'],
        ofis: [1, 1, 2, 2, 2, 3, 3],
        score: 5.9,
      },
      {
        ref: '04',
        type: 'Resurvey',
        visited: on('2026-10-22'),
        due: day(13),
        status: 'draft',
        spots: ['Ph', 'Ph', 'Pm', 'Pl', ['Pl', AMMONIA], 'Oh', 'Ol', 'Ch', 'Cm', 'Cl', 'El'],
        ofis: [1, 2, 3],
        score: 7.1,
      },
    ],
  },
  {
    code: 'S3',
    name: 'Grays Overflow Store',
    address: '2 Globe Industrial Estate, Grays RM17 6ST',
    jurisdiction: 'UK',
    facility: 'Cold store',
    visits: [
      {
        ref: '05',
        type: 'First survey',
        visited: on('2026-11-03'),
        due: day(16),
        status: 'capturing',
        spots: ['Pc', 'Ph', 'Pm', 'Pl', ['Oh', CHARGING[1]], 'Om', 'Ol', 'Cl', 'El', 'Ul', 'Ul'],
        ofis: [],
        score: null,
      },
    ],
  },
  {
    code: 'S4',
    name: 'Tuas Logistics Hub',
    address: '31 Tuas South Avenue 8, Singapore 637651',
    jurisdiction: 'SG',
    facility: 'Distribution warehouse',
    visits: [
      {
        ref: '06',
        type: 'First survey',
        visited: on('2026-10-15'),
        due: day(10),
        status: 'under_review',
        spots: ['Ph', 'Pm', 'Pl', ['Oh', CHARGING[2]], 'Ol', 'Cm', 'Cl', 'El'],
        ofis: [2, 2, 3],
        score: 6.4,
      },
    ],
  },
  {
    code: 'S5',
    name: 'Tilbury Port Depot',
    address: 'Berth 7, Port of Tilbury RM18 7EH',
    jurisdiction: 'UK',
    facility: 'Distribution warehouse',
    visits: [
      {
        ref: '07',
        type: 'First survey',
        visited: on('2026-02-09'),
        due: on('2026-03-02'),
        status: 'finalised',
        spots: ['Ph', 'Ph', 'Oh', 'Pl', 'Cl', 'El', 'El'],
        ofis: [2, 3, 3],
        score: 7.7,
      },
      {
        ref: '08',
        type: 'Follow-up visit',
        visited: on('2026-10-30'),
        due: day(-5),
        status: 'ready',
        spots: ['Ph', 'Pl', 'Ol', 'Cl', 'El', 'El'],
        ofis: [2, 3],
        score: 7.9,
      },
    ],
  },
]

const reference = (visit: Visit) => `${PREFIX}${visit.ref}`

async function remove() {
  const assessments = await AssessmentModel.find(
    { reference: { $regex: `^${PREFIX}` } },
    '_id',
  ).lean()
  const ids = assessments.map((a) => a._id)
  await Promise.all([
    ObservationModel.deleteMany({ assessment: { $in: ids } }),
    ReportOfiModel.deleteMany({ assessment: { $in: ids } }),
    CaptureSessionModel.deleteMany({ assessment: { $in: ids } }),
    ClientInsightSummaryModel.deleteMany({ client: CLIENT._id }),
  ])
  await AssessmentModel.deleteMany({ _id: { $in: ids } })
  await SiteModel.deleteMany({ code: { $regex: `^${PREFIX}` } })
  await ClientModel.deleteMany({ _id: CLIENT._id })
  return ids.length
}

async function add() {
  const alex = await UserModel.findOne({ staffId: 'MRE-0001' }).lean()
  if (!alex) throw new Error('Run `npm run seed` first: Alex (MRE-0001) is missing.')
  await remove()
  await ClientModel.create({ ...CLIENT, key: clientKey(CLIENT.name), division: 'Cold chain' })

  let observations = 0
  for (const site of SITES) {
    const saved = await SiteModel.create({
      code: PREFIX + site.code,
      name: site.name,
      address: site.address,
      jurisdiction: site.jurisdiction,
      facilityType: site.facility,
      client: CLIENT._id,
    })
    for (const visit of site.visits) {
      // Each note's place, once per assessment.
      const next: Record<Category, number> = { C: 0, O: 0, P: 0, E: 0, U: 0 }
      const rows = visit.spots.map((spot) => {
        const [tag, given] = typeof spot === 'string' ? [spot, null] : spot
        const category = tag[0] as Category
        const [where, note] = given ?? NOTES[category][next[category]++ % NOTES[category].length]
        return { category, severity: SEVERITY[tag[1] as Level], where, note }
      })
      const places = [...new Set(rows.map((r) => r.where))]
      const locations = places.map((name) => ({
        _id: new Types.ObjectId(),
        name,
        building: 'Main building',
        key: locationKey(name, undefined, 'Main building'),
      }))
      const assessment = await AssessmentModel.create({
        reference: reference(visit),
        site: saved._id,
        surveyType: visit.type,
        siteVisitDate: visit.visited,
        reportDueDate: visit.due,
        engineer: alex._id,
        locations,
        ...(visit.status !== 'capturing' && visit.status !== 'ready'
          ? { reportStatus: visit.status }
          : {}),
        ...(visit.score !== null && {
          riskQuality: {
            categories: RQR_CATEGORIES.map((category) => ({
              category,
              current: visit.score,
              potential: 9,
            })),
            updatedAt: visit.visited,
            updatedBy: alex._id,
          },
        }),
      })
      const session = await CaptureSessionModel.create({
        assessment: assessment._id,
        status: visit.status === 'capturing' ? 'active' : 'ready_for_generation',
      })
      await ObservationModel.insertMany(
        rows.map((row, i) => ({
          assessment: assessment._id,
          session: session._id,
          engineer: alex.name,
          engineerId: alex._id,
          note: row.note,
          recordings: [],
          severity: row.severity,
          location: locations[places.indexOf(row.where)]._id,
          metadata: {
            source_type: 'observation',
            jurisdiction: site.jurisdiction,
            facility_type: site.facility,
            COPE_dimension: COPE[row.category],
            effective_date: visit.visited,
          },
          // A minute apart, on the visit day, so they list in the order written.
          createdAt: new Date(visit.visited.getTime() + (9 * 60 + i) * 60_000),
        })),
      )
      observations += rows.length
      await ReportOfiModel.insertMany(
        visit.ofis.map((priority, i) => ({
          assessment: assessment._id,
          state: 'accepted',
          acceptedAt: visit.visited,
          acceptedBy: alex._id,
          title: `Demo recommendation ${i + 1}`,
          category: i % 3 === 2 ? 'Management Programs' : 'Physical Protection',
          type: 'Fire Protection System',
          description: 'Demo recommendation for the CP-29 Insights tab.',
          observation: 'See the observations of this assessment.',
          likelihood: 'Possible',
          consequence: 'Major',
          effort: 'Minor Capital',
          priority: `Priority ${priority}`,
          observations: [],
          standards: [],
          precedent: null,
          provenance: {
            provider: 'demo',
            model: 'demo',
            effort: 'none',
            prompt_version: 'demo',
            config_version: 'demo',
            generated_at: visit.visited,
          },
          createdBy: alex._id,
          metadata: {
            source_type: 'ofi',
            jurisdiction: site.jurisdiction,
            facility_type: site.facility,
            COPE_dimension: 'all',
            effective_date: visit.visited,
          },
        })),
      )
    }
  }
  return { sites: SITES.length, observations }
}

async function main() {
  await connectDb()
  if (process.argv.includes('--remove')) {
    console.log(`Removed the CP-29 demo: ${await remove()} assessments.`)
  } else {
    const made = await add()
    console.log(
      `Added the CP-29 demo: ${CLIENT.name}, ${made.sites} sites, ${made.observations} observations. ` +
        'Sign in as Alex Rowe and open Clients.',
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
