import { isValidObjectId, type Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'

export class UnknownClientError extends Error {
  constructor() {
    super('Choose one of the listed clients, or name a new one.')
  }
}
export class UnknownSiteError extends Error {
  constructor() {
    super("Choose one of this client's sites, or add a new one.")
  }
}
export class DuplicateSiteError extends Error {
  constructor(name: string) {
    super(`This client already has a site named ${name}. Choose it from the list instead.`)
  }
}
export class SiteSharedError extends Error {
  constructor() {
    super(
      "This site has other assessments, so its details can't be changed here. They stay as they are.",
    )
  }
}

// The name as clients are matched (CP-17): lowercased, with its spacing
// tidied, so "Northgate  Logistics" and "northgate logistics" are one client.
export function clientKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

// The client with this name, whatever its case or spacing, added with the
// name as given when there is none. Two adding the same name at once both get
// the one saved: the loser's upsert hits the unique key and reads it instead.
export async function findOrCreateClient(name: string) {
  const key = clientKey(name)
  const upsert = () =>
    ClientModel.findOneAndUpdate(
      { key },
      { $setOnInsert: { name: name.trim().replace(/\s+/g, ' '), key } },
      { upsert: true, returnDocument: 'after' },
    ).lean()
  try {
    return await upsert()
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) throw error
    return await upsert()
  }
}

// A listed client, by its id; UnknownClientError when there is none.
export async function getClient(id: string) {
  const client = isValidObjectId(id) ? await ClientModel.findById(id).lean() : null
  if (!client) throw new UnknownClientError()
  return client
}

// The client's name as the assessment shows it: its site's client, or, for a
// site not yet migrated, the name typed on the assessment before CP-17.
export function clientNameOf(site: { client?: unknown } | null | undefined, typed?: string) {
  const client = site?.client as { name?: string } | undefined
  return client?.name ?? typed ?? ''
}

export type ClientDto = { id: string; name: string; sites: number }

// Every client, whoever added it (CP-17 AC3), in name order, with how many
// sites each has. The create form filters them as the engineer types and
// checks a new name against them for a likely typo.
// ponytail: search on the server once the list outgrows one response.
export async function listClients(): Promise<ClientDto[]> {
  const [clients, counts] = await Promise.all([
    ClientModel.find({}, 'name').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean(),
    SiteModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { client: { $exists: true } } },
      { $group: { _id: '$client', n: { $sum: 1 } } },
    ]),
  ])
  const sites = new Map(counts.map((c) => [String(c._id), c.n]))
  return clients.map((c) => ({
    id: String(c._id),
    name: c.name,
    sites: sites.get(String(c._id)) ?? 0,
  }))
}

// A site's latest visit not archived: the one a new assessment there copies
// its locations from (CP-17 AC5), whatever its status. Latest by visit date,
// then by when it was created, as the work list orders them.
export async function latestVisit(site: Types.ObjectId) {
  return AssessmentModel.findOne(
    { site, archivedAt: { $exists: false } },
    'reference siteVisitDate locations',
  )
    .sort({ siteVisitDate: -1, createdAt: -1 })
    .lean()
}

export type VisitDto = {
  reference: string
  siteVisitDate: string | null
  // What a new assessment would copy: its locations, and the buildings they are in.
  locations: number
  buildings: number
}

export type ClientSiteDto = {
  id: string
  code: string
  name: string
  address: string | null
  jurisdiction: string
  facilityType: string
  latest: VisitDto | null
}

// The client's sites in name order (CP-17 AC4), each with its latest visit.
export async function listClientSites(clientId: string): Promise<ClientSiteDto[]> {
  const client = await getClient(clientId)
  const sites = await SiteModel.find({ client: client._id })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean()
  return Promise.all(
    sites.map(async (site) => {
      const latest = await latestVisit(site._id)
      const locations = latest?.locations ?? []
      return {
        id: String(site._id),
        code: site.code,
        name: site.name,
        address: site.address ?? null,
        jurisdiction: site.jurisdiction,
        facilityType: site.facilityType,
        latest: latest && {
          reference: latest.reference,
          siteVisitDate: latest.siteVisitDate?.toISOString().slice(0, 10) ?? null,
          locations: locations.length,
          buildings: new Set(locations.flatMap((l) => (l.building ? [clientKey(l.building)] : [])))
            .size,
        },
      }
    }),
  )
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Refuses a site name the client already has, whatever its case (CP-17 AC10).
// Sites saved before CP-17 may already share a name; they stay, but no new
// one joins them.
export async function refuseDuplicateSite(
  client: Types.ObjectId,
  name: string,
  except?: Types.ObjectId,
) {
  const taken = await SiteModel.exists({
    client,
    name: new RegExp(`^${escape(name.trim())}$`, 'i'),
    ...(except && { _id: { $ne: except } }),
  })
  if (taken) throw new DuplicateSiteError(name.trim())
}

// Whether the site has an assessment other than this one that is not
// archived (CP-17 AC8): its details are then shared, and locked.
export async function isSiteShared(site: Types.ObjectId, except: Types.ObjectId) {
  return !!(await AssessmentModel.exists({
    site,
    _id: { $ne: except },
    archivedAt: { $exists: false },
  }))
}

// For each of these sites, how many of its assessments are not archived, so a
// list can tell which are shared without a query per row.
export async function liveVisitCounts(sites: Types.ObjectId[]) {
  const counts = await AssessmentModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { site: { $in: sites }, archivedAt: { $exists: false } } },
    { $group: { _id: '$site', n: { $sum: 1 } } },
  ])
  return new Map(counts.map((c) => [String(c._id), c.n]))
}
