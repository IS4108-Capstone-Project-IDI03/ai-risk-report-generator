// Demo data for the CP-23 click-through: clients with several sites, assessments in
// every state and documents. `npm run seed:cp23` adds it, `npm run seed:cp23:remove`
// removes only it. Run by hand; never by the app or tests. Needs `npm run seed` first
// (the engineer accounts).
//
// Everything it adds is recognisable: fixed ids for clients and documents, and a
// DEMO23- prefix on site codes and assessment references. Adding is an upsert, so
// running it twice changes nothing; removing never touches anything else.
// Each document also gets a small placeholder file in storage (the app's own
// storage.service), so downloading one works; remove deletes those files too.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientModel } from '../models/client.model'
import { connectDb } from '../models/db'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { clientKey } from '../services/client.service'
import * as storage from '../services/storage.service'

const PREFIX = 'DEMO23-'
// A fixed id per demo row, so a second run finds the first run's rows.
const demoId = (kind: 'c' | 'd', n: number) =>
  new Types.ObjectId(`c23${kind}${String(n).padStart(20, '0')}`)
const day = (offset: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offset)
  return d
}

type DemoClient = { name: string; division?: string; jurisdiction: string; facility: string[] }
// 9 clients, 4 jurisdictions (codes as the app's lists use them). The long and non-Latin names are on purpose.
const CLIENTS: DemoClient[] = [
  {
    name: 'Northgate Freight Group',
    division: 'Logistics',
    jurisdiction: 'UK',
    facility: ['Distribution warehouse', 'Cold store'],
  },
  {
    name: 'Fennick Farms Ltd',
    division: 'Food Division',
    jurisdiction: 'UK',
    facility: ['Cold store'],
  },
  {
    name: 'Straits Harbour Holdings',
    division: 'Port operations',
    jurisdiction: 'SG',
    facility: ['Port terminal', 'Distribution warehouse'],
  },
  {
    name: 'Jurong Chemicals Pte Ltd',
    division: 'Specialty chemicals',
    jurisdiction: 'SG',
    facility: ['Chemical plant'],
  },
  { name: 'Kampung Retail Group', jurisdiction: 'MY', facility: ['Shopping mall', 'Office'] },
  {
    name: 'Penang Paper Mills Berhad',
    division: 'Packaging',
    jurisdiction: 'MY',
    facility: ['Paper mill'],
  },
  {
    name: '香港環球物流有限公司',
    division: '貨倉業務',
    jurisdiction: 'HK',
    facility: ['Distribution warehouse', 'Data centre'],
  },
  {
    name: 'Victoria Peak Properties',
    jurisdiction: 'HK',
    facility: ['Mixed-use development', 'Office'],
  },
  {
    name: 'A Very Long Client Name For Testing Wrapping Across Several Lines Ltd',
    division: 'Group risk and insurance',
    jurisdiction: 'SG',
    facility: ['Data centre'],
  },
]
const SITE_COUNTS = [4, 1, 5, 2, 3, 1, 3, 2, 1]
const LONG_SITE = 'Tuas Mega Distribution and Cold Chain Hub, Building C, Block 4 East'
const ADDRESS = '12 Example Road, Industrial Estate\nPostcode 123456'
const SITE_NAMES = [
  'Main campus',
  'North depot',
  LONG_SITE,
  'Riverside plant',
  '東區倉庫 East warehouse',
]

type State = 'none' | 'draft' | 'review' | 'final' | 'archived'
// A site's first visit is a First survey; later ones are these (VISIT_TYPES in assessment.model.ts).
const LATER_VISITS = ['Resurvey', 'Follow-up visit'] as const
const STATUS: State[] = ['none', 'draft', 'review', 'none', 'draft', 'none']
// Report-due offsets: late, due this week, on track, not set.
const DUE: (number | null)[] = [-12, 4, 40, null]

// A few bytes that stand in for the document: a tiny real PDF, otherwise short text.
function placeholder(ext: string, n: number): Buffer {
  if (ext === 'pdf')
    return Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    )
  return Buffer.from(`Demo document ${n} for the CP-23 click-through.\n`)
}

async function engineers() {
  const [alex, jide] = await Promise.all([
    UserModel.findOne({ staffId: 'MRE-0001' }).lean(),
    UserModel.findOne({ staffId: 'MRE-0002' }).lean(),
  ])
  if (!alex || !jide) throw new Error('Run `npm run seed` first: Alex and Jide are missing.')
  return { alex: alex._id, jide: jide._id }
}

// Refuses before any write when a demo client's name is already a real client's:
// the upsert would otherwise clash on the unique key halfway, and remove would
// then delete the real one's rows.
async function preflight() {
  const demoIds = CLIENTS.map((_, i) => demoId('c', i + 1))
  const clash = await ClientModel.findOne({
    key: { $in: CLIENTS.map((c) => clientKey(c.name)) },
    _id: { $nin: demoIds },
  }).lean()
  if (clash)
    throw new Error(`Client ${clash.name} already exists; rename it in the seed or remove it`)
}

/** Throws unless the database is the local riskreport one; the seed must never touch a shared db. */
export function assertLocalTarget(name: string, host: string) {
  if (name !== 'riskreport' || !['localhost', '127.0.0.1', 'mongo'].includes(host))
    throw new Error(
      `Refusing to run on database "${name}" at "${host}": only riskreport on localhost.`,
    )
}

export async function add() {
  const { alex, jide } = await engineers()
  await preflight()
  const counts = { sites: 0, assessments: 0, documents: 0 }
  let ref = 0
  let doc = 0
  for (const [i, c] of CLIENTS.entries()) {
    const clientId = demoId('c', i + 1)
    await ClientModel.updateOne(
      { _id: clientId },
      {
        $set: { name: c.name, key: clientKey(c.name), ...(c.division && { division: c.division }) },
      },
      { upsert: true },
    )
    const sites: { _id: Types.ObjectId; name: string; facility: string }[] = []
    for (let s = 0; s < SITE_COUNTS[i]; s++) {
      const name = SITE_NAMES[(s + i) % SITE_NAMES.length]
      const facility = c.facility[s % c.facility.length]
      const site = await SiteModel.findOneAndUpdate(
        { code: `${PREFIX}C${i + 1}-S${s + 1}` },
        {
          $set: {
            name,
            address: ADDRESS,
            jurisdiction: c.jurisdiction,
            facilityType: facility,
            client: clientId,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      sites.push({ _id: site._id, name, facility })
      counts.sites++
    }
    // Northgate Freight (0) has 6 open; Fennick Farms (1) has everything archived, so it can be removed;
    // Straits (2) is shared with Jide; Jurong (3) has a finalised report.
    const perSite = i === 0 ? [2, 2, 1, 1] : i === 1 ? [2] : i === 8 ? [1] : [2, 1, 1, 1, 1]
    for (const [s, site] of sites.entries()) {
      for (let v = 0; v < (perSite[s] ?? 1); v++) {
        ref++
        let state: State = STATUS[ref % STATUS.length]
        if (i === 1) state = 'archived'
        if (i === 3 && s === 0 && v === 0) state = 'final'
        const due = DUE[ref % DUE.length]
        const visit = day(ref % 5 === 0 ? 30 + ref : -20 + ref * 3)
        await AssessmentModel.updateOne(
          { reference: `${PREFIX}${String(ref).padStart(4, '0')}` },
          {
            $set: {
              site: site._id,
              surveyType: v === 0 ? 'First survey' : LATER_VISITS[(v + s) % 2],
              siteVisitDate: visit,
              ...(ref % 7 === 0 && { siteVisitEndDate: day(31 + ref) }),
              ...(due !== null &&
                state !== 'final' &&
                state !== 'archived' && { reportDueDate: day(due) }),
              ...(ref % 4 === 0 && { siteContacts: [{ name: 'Joan Pike', role: 'Site manager' }] }),
              engineer: i === 2 && s === 1 ? jide : alex,
              ...(state === 'draft' && { reportStatus: 'draft' }),
              ...(state === 'review' && { reportStatus: 'under_review' }),
              ...(state === 'final' && { reportStatus: 'finalised' }),
              ...(state === 'archived' && { archivedAt: day(-3) }),
              locations: [],
              appendixPhotos: [],
            },
          },
          { upsert: true },
        )
        counts.assessments++
      }
    }
    // Documents: 1 to 12 per client, spread over each kind of tag and file type.
    const EXTS = [
      ['pdf', 'application/pdf'],
      ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['doc', 'application/msword'],
      ['msg', 'application/vnd.ms-outlook'],
      ['eml', 'message/rfc822'],
    ]
    const nDocs = [7, 3, 12, 1, 5, 2, 8, 4, 6][i]
    for (let d = 0; d < nDocs; d++) {
      doc++
      const [ext, contentType] = EXTS[d % EXTS.length]
      const site = d % 3 === 0 ? null : sites[d % sites.length]
      const kind = d % 3 === 0 ? 'client' : 'site'
      const id = demoId('d', doc)
      const key = `client-documents/demo23/${id}.${ext}`
      await storage.putObject(key, placeholder(ext, doc), contentType)
      await ClientDocumentModel.updateOne(
        { _id: id },
        {
          $set: {
            client: clientId,
            placement: { kind, ...(site && { site: site._id }) },
            name:
              d === 1
                ? 'A_really_long_document_name_that_goes_on_and_on_for_testing_final_v7.' + ext
                : `Document ${doc}.${ext}`,
            contentType,
            size: 12_000 * (d + 1),
            sha256: createHash('sha256').update(`demo23-${doc}`).digest('hex'),
            key,
            origin: d % 2 ? 'upload' : 'intake',
            uploaded: { at: day(-d - 1), by: { id: String(alex), name: 'Alex Rowe' } },
            metadata: {
              source_type: 'client_document',
              jurisdiction: site ? c.jurisdiction : null,
              facility_type: site ? site.facility : null,
              COPE_dimension: null,
              effective_date: day(-d - 1),
            },
          },
        },
        { upsert: true },
      )
      counts.documents++
    }
  }
  console.log(
    `Demo data in place: ${CLIENTS.length} clients, ${counts.sites} sites, ${counts.assessments} assessments, ${counts.documents} documents.`,
  )
}

// Removes what add() made: the fixed client and document ids, the DEMO23- sites
// and assessments, and anything else filed under a demo client (so no orphans).
export async function remove() {
  const ids = (kind: 'c' | 'd', n: number) =>
    Array.from({ length: n }, (_, i) => demoId(kind, i + 1))
  const starts = new RegExp(`^${PREFIX}`)
  const clients = ids('c', CLIENTS.length)
  const sites = await SiteModel.find(
    { $or: [{ code: starts }, { client: { $in: clients } }] },
    '_id',
  ).lean()
  const documents = { $or: [{ _id: { $in: ids('d', 200) } }, { client: { $in: clients } }] }
  const docs = await ClientDocumentModel.find(documents, 'key').lean()
  await Promise.all(docs.map((d) => storage.deleteObject(d.key).catch(() => undefined)))
  const results = await Promise.all([
    ClientDocumentModel.deleteMany(documents),
    AssessmentModel.deleteMany({
      $or: [{ reference: starts }, { site: { $in: sites.map((x) => x._id) } }],
    }),
    SiteModel.deleteMany({ _id: { $in: sites.map((x) => x._id) } }),
    ClientModel.deleteMany({ _id: { $in: clients } }),
  ])
  console.log(
    `Removed ${results[0].deletedCount} documents, ${results[1].deletedCount} assessments, ${results[2].deletedCount} sites, ${results[3].deletedCount} clients.`,
  )
}

async function main() {
  await connectDb()
  assertLocalTarget(mongoose.connection.name, mongoose.connection.host)
  await (process.argv.includes('--remove') ? remove() : add())
  await mongoose.disconnect()
}
// Only when run as a script, so a test can import add and remove.
if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
