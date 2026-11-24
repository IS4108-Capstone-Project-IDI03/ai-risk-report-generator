// Demo data for the CP-61 building stack: one client with one site whose
// assessment has two buildings of several levels, a basement, a whole-building
// location and locations elsewhere on site, with observations of every
// severity and five locations left with nothing recorded, so every kind of
// cell has something to show.
// `npm run seed:cp61` adds it, `npm run seed:cp61:remove` removes only it.
// Run by hand; never by the app or tests. Needs `npm run seed` first (Alex's
// account).
//
// Kept apart from the CP-29 demo (seed-cp29-demo.ts), whose client's Insights
// figures are tuned and would change with another site. Everything it adds is
// recognisable: a fixed id for the client, and a DEMO61- prefix on the site
// code and assessment reference. Adding removes the earlier run's rows first,
// so running it twice leaves one copy; removing never touches anything else.
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ClientModel } from '../models/client.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension, type Severity } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { clientKey } from '../services/client.service'
import { locationKey } from '../services/location.service'

const PREFIX = 'DEMO61-'
const REFERENCE = PREFIX + '01'
const CLIENT = {
  _id: new Types.ObjectId('c61c00000000000000000001'),
  name: 'Meridian Fulfilment',
}
const SITE = {
  code: PREFIX + 'S1',
  name: 'Jurong Fulfilment Centre',
  address: '12 Jurong Pier Road, Singapore 619155',
  jurisdiction: 'SG',
  facility: 'Distribution warehouse',
}

const day = (offset: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offset)
  return d
}

// One finding: its categories' initials (C, O, P, E; '' is uncategorised), its
// severity's initial (c, h, m, l; '-' is none yet), and the note. `deleted`
// marks one the engineer deleted, which the stack must not count.
type Finding = [categories: string, severity: string, note: string, deleted?: 'deleted']
type Place = { building?: string; floor?: string; name: string; findings: Finding[] }

const COPE: Record<string, CopeDimension> = {
  C: 'Construction',
  O: 'Occupancy',
  P: 'Protection',
  E: 'Exposure',
}
const SEVERITY: Record<string, Severity | null> = {
  c: 'critical',
  h: 'high',
  m: 'moderate',
  l: 'low',
  '-': null,
}

// The site, in the order an engineer would walk it. Levels are spelt the way
// the app sorts them (Basement 1, Ground, Level 1, Roof).
const PLACES: Place[] = [
  // Block A: a warehouse with offices above and a basement below.
  {
    building: 'Block A',
    name: 'Facade',
    findings: [
      ['C', 'l', 'Cladding panel is loose at the north-east corner, about 6 m above ground.'],
    ],
  },
  {
    building: 'Block A',
    floor: 'Roof',
    name: 'Roof plant',
    findings: [['C', 'm', 'Entered at the wrong location; the flashing is on Block B.', 'deleted']],
  },
  {
    building: 'Block A',
    floor: 'Level 2',
    name: 'Office',
    findings: [['O', 'l', 'Portable heaters are under two desks, plugged into extension leads.']],
  },
  {
    building: 'Block A',
    floor: 'Level 2',
    name: 'Server room',
    findings: [
      ['P', 'h', 'Gas suppression cylinder gauge reads below the green band.'],
      ['CP', 'm', 'Cable openings through the server room wall are not fire-stopped.'],
    ],
  },
  { building: 'Block A', floor: 'Level 2', name: 'Staircase', findings: [] },
  {
    building: 'Block A',
    floor: 'Level 1',
    name: 'Mezzanine store',
    findings: [
      ['P', 'm', 'Cartons are stacked to within 0.3 m of the sprinkler heads.'],
      ['C', 'm', 'Mezzanine deck is timber on unprotected steel.'],
      ['O', 'l', 'Aerosol stock is kept with general goods, with no cage.'],
    ],
  },
  {
    building: 'Block A',
    floor: 'Level 1',
    name: 'Lift lobby',
    // No severity yet: one the engineer still has to settle (CP-24).
    findings: [['P', '-', 'Fire door is held open with a wedge.']],
  },
  {
    building: 'Block A',
    floor: 'Ground',
    name: 'Loading bay',
    findings: [
      ['P', 'c', 'Sprinkler control valve was found shut, with no impairment tag.'],
      ['O', 'h', 'Idle timber pallets are stacked 4 m high beside the dock doors.'],
      ['O', 'm', 'Forklift battery is charging beside stored cartons.'],
      ['O', 'l', 'Dock leveller pit holds waste cardboard.'],
    ],
  },
  {
    building: 'Block A',
    floor: 'Ground',
    name: 'Fire pump room',
    findings: [
      ['P', 'h', 'Diesel fire pump controller was left in manual.'],
      ['P', 'm', 'Weekly pump run log was last filled in in March.'],
    ],
  },
  {
    building: 'Block A',
    floor: 'Ground',
    name: 'Switch room',
    findings: [['O', 'm', 'Cardboard boxes are stored in front of the switchboard.']],
  },
  {
    building: 'Block A',
    floor: 'Basement 1',
    name: 'Sprinkler tank',
    findings: [['P', 'l', 'Tank gauge reads full, but the low-level alarm was not tested.']],
  },
  { building: 'Block A', floor: 'Basement 1', name: 'Car park', findings: [] },
  // Block B: production, two levels.
  {
    building: 'Block B',
    floor: 'Level 1',
    name: 'Control room',
    findings: [['P', 'l', 'One emergency light does not come on under test.']],
  },
  {
    building: 'Block B',
    floor: 'Level 1',
    name: 'Battery room',
    findings: [
      ['P', 'c', 'Lithium-ion battery racks have no detection or suppression in the room.'],
      ['C', 'h', 'Battery room door is not fire rated.'],
    ],
  },
  {
    building: 'Block B',
    floor: 'Ground',
    name: 'Production area',
    findings: [
      ['O', 'h', 'Hot work is under way with no permit displayed.'],
      ['O', 'h', 'Solvent drums are stored on the open floor, about 800 L.'],
      ['P', 'm', 'Sprinkler head is painted over above line 3.'],
      ['O', 'm', 'Dust has built up on the overhead cable trays.'],
      ['P', 'l', 'Extinguisher by line 2 is past its service date.'],
    ],
  },
  { building: 'Block B', floor: 'Ground', name: 'Chiller plant', findings: [] },
  {
    building: 'Block B',
    floor: 'Ground',
    name: 'Workshop',
    findings: [
      ['O', 'm', 'Oily rags are left in an open bin.'],
      ['O', 'l', 'Gas cylinders are stood unchained.'],
    ],
  },
  // Elsewhere on site.
  {
    name: 'Fire access route',
    findings: [['E', 'm', 'Parked trailers narrow the fire access route to about 3 m.']],
  },
  {
    name: 'Diesel tank',
    findings: [
      ['E', 'h', 'Diesel tank bund holds rainwater to half its depth.'],
      ['E', 'm', 'There is no impact protection on the road side of the tank.'],
    ],
  },
  { name: 'Guardhouse', findings: [] },
  {
    name: 'Bin centre',
    // Uncategorised: kept out of category-scoped drafting until it is tagged (CP-02).
    findings: [['', 'l', 'Bin centre is 4 m from the Block B wall.']],
  },
]

async function remove() {
  const assessments = await AssessmentModel.find(
    { reference: { $regex: `^${PREFIX}` } },
    '_id',
  ).lean()
  const ids = assessments.map((a) => a._id)
  await Promise.all([
    ObservationModel.deleteMany({ assessment: { $in: ids } }),
    CaptureSessionModel.deleteMany({ assessment: { $in: ids } }),
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
  await ClientModel.create({ ...CLIENT, key: clientKey(CLIENT.name), division: 'E-commerce' })
  const site = await SiteModel.create({
    code: SITE.code,
    name: SITE.name,
    address: SITE.address,
    jurisdiction: SITE.jurisdiction,
    facilityType: SITE.facility,
    client: CLIENT._id,
  })
  const locations = PLACES.map((p) => ({
    _id: new Types.ObjectId(),
    name: p.name,
    ...(p.building && { building: p.building }),
    ...(p.floor && { floor: p.floor }),
    key: locationKey(p.name, p.floor, p.building),
  }))
  // Surveyed yesterday and still being captured, so observations can be added.
  const visited = day(-1)
  const assessment = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    surveyType: 'First survey',
    siteVisitDate: visited,
    reportDueDate: day(14),
    engineer: alex._id,
    locations,
  })
  const session = await CaptureSessionModel.create({
    assessment: assessment._id,
    status: 'active',
  })
  const rows = PLACES.flatMap((p, at) =>
    p.findings.map(([categories, severity, note, deleted]) => ({
      location: locations[at]._id,
      categories,
      severity,
      note,
      deleted,
    })),
  )
  await ObservationModel.insertMany(
    rows.map((row, i) => {
      // A minute apart, on the visit day, so they list in the order written.
      const createdAt = new Date(visited.getTime() + (9 * 60 + i) * 60_000)
      return {
        assessment: assessment._id,
        session: session._id,
        engineer: alex.name,
        engineerId: alex._id,
        note: row.note,
        recordings: [],
        severity: SEVERITY[row.severity],
        location: row.location,
        ...(row.deleted && {
          deleted: {
            at: new Date(createdAt.getTime() + 5 * 60_000),
            by: { id: String(alex._id), name: alex.name },
          },
        }),
        metadata: {
          source_type: 'observation',
          jurisdiction: SITE.jurisdiction,
          facility_type: SITE.facility,
          // Present but null when uncategorised, never [] (CP-02).
          COPE_dimension: row.categories ? [...row.categories].map((c) => COPE[c]) : null,
          effective_date: visited,
        },
        createdAt,
      }
    }),
  )
  return {
    locations: locations.length,
    empty: PLACES.filter((p) => !p.findings.some((f) => !f[3])).length,
    observations: rows.filter((r) => !r.deleted).length,
  }
}

async function main() {
  await connectDb()
  if (process.argv.includes('--remove')) {
    console.log(`Removed the CP-61 demo: ${await remove()} assessment.`)
  } else {
    const made = await add()
    console.log(
      `Added the CP-61 demo: ${CLIENT.name}, ${SITE.name} (${REFERENCE}), ` +
        `${made.locations} locations (${made.empty} with nothing recorded), ` +
        `${made.observations} observations. Sign in as Alex Rowe, open ${REFERENCE}, ` +
        'then Observations and Buildings.',
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
