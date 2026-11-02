import { z } from 'zod'
import { isValidObjectId, Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import type { IStamp } from '../models/observation.model'
import { SiteModel, type ISite } from '../models/site.model'
import type { SessionUser } from './auth.service'
import { FACILITY_TYPES } from './knowledge-document.service'
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

// A new or changed facility type must be one the forms offer, since the
// knowledge base's labels and the checklist's hazards (CP-30) use only those.
// An older site's type, kept unchanged, is not refused, so it can still be
// corrected.
export const FACILITY_TYPE_RULE = 'Choose a facility type from the list.'
export class UnknownFacilityTypeError extends Error {
  constructor() {
    super(FACILITY_TYPE_RULE)
    this.name = 'UnknownFacilityTypeError'
  }
}

// A change to a client or site refused (CP-18), with the status the routes
// answer: 404 unknown, 403 not the engineer's to change, 409 in the wrong
// state (finalised, removed, not archived).
export class ClientSiteError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message)
    this.name = 'ClientSiteError'
  }
}
// A value refused (CP-18): 400, naming the field.
export class ClientSiteFieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
    this.name = 'ClientSiteFieldError'
  }
}

// The name as clients are matched (CP-17): lowercased, with its spacing
// tidied, so "Northgate  Logistics" and "northgate logistics" are one client.
export function clientKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

// The name as it is saved: trimmed, with its spacing tidied.
const tidy = (name: string) => name.trim().replace(/\s+/g, ' ')

// The client with this name, whatever its case or spacing, added with the
// name as given when there is none. Two adding the same name at once both get
// the one saved: the loser's upsert hits the unique key and reads it instead.
// A client whose sites are all removed (CP-18) is found too, which brings it
// back once its new site is added.
export async function findOrCreateClient(name: string) {
  const key = clientKey(name)
  const upsert = () =>
    ClientModel.findOneAndUpdate(
      { key },
      { $setOnInsert: { name: tidy(name), key } },
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

// A site still listed: not removed (CP-18).
const LISTED = { removed: { $exists: false } }

export type ClientDto = { id: string; name: string; sites: number }

// Every client, whoever added it (CP-17 AC3), in name order, with how many
// sites each has. The create form filters them as the engineer types and
// checks a new name against them for a likely typo. A client whose sites are
// all removed is left out (CP-18); typing its name brings it back.
// ponytail: search on the server once the list outgrows one response.
export async function listClients(): Promise<ClientDto[]> {
  const [clients, counts] = await Promise.all([
    ClientModel.find({}, 'name').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean(),
    SiteModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { client: { $exists: true }, ...LISTED } },
      { $group: { _id: '$client', n: { $sum: 1 } } },
    ]),
  ])
  const sites = new Map(counts.map((c) => [String(c._id), c.n]))
  return clients.flatMap((c) => {
    const n = sites.get(String(c._id)) ?? 0
    return n ? [{ id: String(c._id), name: c.name, sites: n }] : []
  })
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
// Removed ones are left out (CP-18), so a new assessment can't be put on one.
export async function listClientSites(clientId: string): Promise<ClientSiteDto[]> {
  const client = await getClient(clientId)
  const sites = await SiteModel.find({ client: client._id, ...LISTED })
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

// Whether the client has a listed site of this name, whatever its case,
// other than this one. A removed site's name is free (CP-18): a colleague
// can't see it to restore it, so it must not stop them adding theirs.
export async function siteNameTaken(
  client: Types.ObjectId,
  name: string,
  except?: Types.ObjectId,
): Promise<boolean> {
  return !!(await SiteModel.exists({
    client,
    name: new RegExp(`^${escape(name.trim())}$`, 'i'),
    ...LISTED,
    ...(except && { _id: { $ne: except } }),
  }))
}

// Refuses a site name the client already has, whatever its case (CP-17 AC10).
// Sites saved before CP-17 may already share a name; they stay, but no new
// one joins them.
export async function refuseDuplicateSite(
  client: Types.ObjectId,
  name: string,
  except?: Types.ObjectId,
) {
  if (await siteNameTaken(client, name, except)) throw new DuplicateSiteError(name.trim())
}

// Who changed something and when (CP-18), as observations record it (CP-08).
// `by` is the signed-in user as they were then.
const stamp = (user: SessionUser): IStamp => ({
  at: new Date(),
  by: { id: user.id, name: user.name },
})
export type StampDto = { at: Date; by: { id: string; name: string } }
export const stampDto = (s?: IStamp | null): StampDto | null =>
  s ? { at: s.at, by: { id: s.by.id, name: s.by.name } } : null

// What a site's assessments are to the signed-in engineer (CP-18): how many it
// has, archived or not, how many of them are theirs (assigned to them now, so
// a reassigned one moves with its engineer), and how many are archived and
// finalised. An assessment with no engineer is no one's, so never theirs.
export type Holding = { total: number; mine: number; archived: number; finalised: number }
const NONE: Holding = { total: 0, mine: 0, archived: 0, finalised: 0 }

export async function holdings(
  sites: Types.ObjectId[],
  userId: string,
): Promise<Map<string, Holding>> {
  if (!sites.length || !isValidObjectId(userId)) return new Map()
  const rows = await AssessmentModel.aggregate<Holding & { _id: Types.ObjectId }>([
    { $match: { site: { $in: sites } } },
    {
      $group: {
        _id: '$site',
        total: { $sum: 1 },
        mine: { $sum: { $cond: [{ $eq: ['$engineer', new Types.ObjectId(userId)] }, 1, 0] } },
        archived: { $sum: { $cond: [{ $ifNull: ['$archivedAt', false] }, 1, 0] } },
        finalised: { $sum: { $cond: [{ $eq: ['$reportStatus', 'finalised'] }, 1, 0] } },
      },
    },
  ])
  return new Map(rows.map(({ _id, ...h }) => [String(_id), h]))
}

const holdingOf = (held: Map<string, Holding>, site: { _id: Types.ObjectId }) =>
  held.get(String(site._id)) ?? NONE
const sum = (all: Holding[]): Holding =>
  all.reduce(
    (a, h) => ({
      total: a.total + h.total,
      mine: a.mine + h.mine,
      archived: a.archived + h.archived,
      finalised: a.finalised + h.finalised,
    }),
    NONE,
  )

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// Why the engineer can't change a client or site, or null when they can
// (CP-18): every assessment it has, archived or not, must be theirs, and none
// finalised, as a finalised report must keep the details it was signed off
// with. A removed one is changed only by restoring it. Removing also needs
// every assessment archived. Who the other engineer is is never said.
function refusal(
  what: 'site' | 'client',
  h: Holding,
  { removed = false, removing = false } = {},
): ClientSiteError | null {
  if (removed) {
    return new ClientSiteError(
      removing
        ? `This ${what} is already removed.`
        : `This ${what} is removed. Restore it before changing it.`,
      409,
    )
  }
  if (!h.mine) {
    return new ClientSiteError(
      what === 'site'
        ? 'You have no assessments at this site.'
        : 'You have no assessments for this client.',
      403,
    )
  }
  if (h.mine < h.total) {
    return new ClientSiteError(
      what === 'site'
        ? "Another engineer's assessment uses this site, so it can't be changed."
        : "Another engineer has assessments for this client, so it can't be changed.",
      403,
    )
  }
  if (h.finalised) {
    return new ClientSiteError(`This ${what} has a finalised report, so it can't be changed.`, 409)
  }
  const open = h.total - h.archived
  if (removing && open) {
    return new ClientSiteError(
      `${open} of its assessments ${plural(open, 'is', 'are')} not archived. ` +
        `Archive ${plural(open, 'it', 'them')} before removing this ${what}.`,
      409,
    )
  }
  return null
}

// Whether the engineer may do something, and why not, for the buttons.
export type Allowed = { allowed: boolean; reason: string | null }
const allowedUnless = (problem: Error | null): Allowed => ({
  allowed: !problem,
  reason: problem?.message ?? null,
})

// Restoring needs only that every assessment be the engineer's: removal
// already needed them all archived and none finalised.
function restoreRefusal(what: 'site' | 'client', h: Holding): ClientSiteError | null {
  const problem = refusal(what, h)
  return problem?.status === 403 ? problem : null
}

// Whether the engineer may correct their assessments' sites (CP-18), for the
// work list, whose Overview offers Edit site, and how many assessments a
// correction reaches. A client's own rights are the client page's.
export async function changeRights(
  sites: Pick<ISite & { _id: Types.ObjectId }, '_id' | 'removed'>[],
  userId: string,
) {
  const held = await holdings(
    sites.map((s) => s._id),
    userId,
  )
  const byId = new Map(sites.map((s) => [String(s._id), s]))
  // Looked up by the site's id, so a site read with its client populated works too.
  return ({ _id }: { _id: Types.ObjectId }) => {
    const site = byId.get(String(_id))!
    const h = holdingOf(held, site)
    return {
      // How many assessments a correction changes, for its confirm step.
      assessments: h.total,
      change: allowedUnless(refusal('site', h, { removed: !!site.removed })),
    }
  }
}

// ----- Correcting, removing and restoring a site (CP-18) -----

async function siteById(id: string) {
  const site = isValidObjectId(id) ? await SiteModel.findById(id).lean() : null
  if (!site) throw new ClientSiteError('This site was not found.', 404)
  return site
}

// The names it had, with the one it is leaving added and the one it now has
// left out, each once whatever its case or spacing. Masking matches names in
// any case and spacing, so a change of case alone adds none.
function formerWith(former: string[] = [], leaving?: string, now?: string): string[] {
  const seen = new Set(now ? [clientKey(now)] : [])
  return [...former, ...(leaving ? [leaving] : [])].filter((name) => {
    const key = clientKey(name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// A site's details as an engineer corrects them (CP-18), validated by
// siteDetailsSchema in assessment.service.
export type SiteFields = {
  name: string
  address?: string
  jurisdiction: string
  facilityType: string
}

// Corrects a site's name, address, jurisdiction and facility type (CP-18), so
// every assessment at it shows the change. Only when every assessment there,
// archived or not, is the engineer's, none is finalised, and the site is not
// removed. Its old name and address are kept for masking (PV-02). Observations
// keep the jurisdiction and facility type they were saved with, and drafts
// written for another scope show as out of date (section.service).
// ponytail: the check reads, then writes; a colleague creating a visit there
// in between is not refused. Rare, and their visit then shows the change.
export async function correctSite(id: string, input: SiteFields, user: SessionUser) {
  const site = await siteById(id)
  const problem = refusal('site', holdingOf(await holdings([site._id], user.id), site), {
    removed: !!site.removed,
  })
  if (problem) throw problem
  const { address, ...details } = input
  const changed =
    site.name !== details.name ||
    (site.address ?? undefined) !== address ||
    site.jurisdiction !== details.jurisdiction ||
    site.facilityType !== details.facilityType
  if (!changed) return
  if (site.facilityType !== details.facilityType && !FACILITY_TYPES.includes(details.facilityType))
    throw new UnknownFacilityTypeError()
  if (site.client && site.name !== details.name)
    await refuseDuplicateSite(site.client, details.name, site._id)
  const formerNames = formerWith(site.formerNames, site.name, details.name)
  const formerAddresses = formerWith(site.formerAddresses, site.address, address)
  await SiteModel.updateOne(
    { _id: site._id },
    {
      $set: {
        ...details,
        ...(address && { address }),
        ...(formerNames.length && { formerNames }),
        ...(formerAddresses.length && { formerAddresses }),
        edited: stamp(user),
      },
      ...(!address && { $unset: { address: 1 } }),
    },
  )
}

// Removes a site (CP-18), a soft removal: it leaves the client's page and the
// create form, and nothing it holds changes. Only when every assessment there
// is the engineer's and archived, and none finalised. Matching on `removed`
// makes it atomic, so a double click removes it once.
export async function removeSite(id: string, user: SessionUser) {
  const site = await siteById(id)
  const problem = refusal('site', holdingOf(await holdings([site._id], user.id), site), {
    removed: !!site.removed,
    removing: true,
  })
  if (problem) throw problem
  const { modifiedCount } = await SiteModel.updateOne(
    { _id: site._id, ...LISTED },
    { $set: { removed: stamp(user) } },
  )
  if (!modifiedCount) throw new ClientSiteError('This site is already removed.', 409)
}

// The body of POST /api/sites/:id/restore: a new name, needed only when the
// client has since added another site of its name.
export const siteRestoreSchema = z.object({
  name: z
    .string()
    .trim()
    .max(200, 'Site name must be 200 characters or fewer.')
    .optional()
    .transform((value) => value || undefined),
})

// Restores a removed site to its client's page and the create form (CP-18).
// It never makes two listed sites of one name (CP-17 AC10): when the client has
// since added another site of its name, it is restored only under a new one.
export async function restoreSite(id: string, user: SessionUser, name?: string) {
  const site = await siteById(id)
  if (!site.removed) throw new ClientSiteError('This site is not removed.', 409)
  const problem = restoreRefusal('site', holdingOf(await holdings([site._id], user.id), site))
  if (problem) throw problem
  const restoredName = name ? tidy(name) : site.name
  if (site.client && (await siteNameTaken(site.client, restoredName, site._id))) {
    throw new ClientSiteFieldError(
      'name',
      name
        ? `This client already has a site named ${restoredName}.`
        : `This client now has another site named ${site.name}. Restore this one under another name.`,
    )
  }
  const renamed = restoredName !== site.name
  const formerNames = formerWith(site.formerNames, site.name, restoredName)
  const { modifiedCount } = await SiteModel.updateOne(
    { _id: site._id, removed: { $exists: true } },
    {
      $unset: { removed: 1 },
      ...(renamed && {
        $set: {
          name: restoredName,
          ...(formerNames.length && { formerNames }),
          edited: stamp(user),
        },
      }),
    },
  )
  if (!modifiedCount) throw new ClientSiteError('This site is not removed.', 409)
}

// Brings back an assessment's removed site as the assessment is restored
// (CP-18), so a restored assessment never sits on a removed site. When the
// client has since added another site of its name, it refuses instead: the
// site is restored under a new name from the client's page first.
export async function restoreSiteOf(siteId: Types.ObjectId) {
  const site = await SiteModel.findById(siteId, 'name client removed').lean()
  if (!site?.removed) return
  if (site.client && (await siteNameTaken(site.client, site.name, site._id))) {
    throw new ClientSiteError(
      `Its site, ${site.name}, is removed, and the client now has another site of that name. ` +
        'Restore the site under another name from the client page first.',
      409,
    )
  }
  await SiteModel.updateOne({ _id: site._id }, { $unset: { removed: 1 } })
}

// ----- Renaming, removing and restoring a client (CP-18) -----

async function clientById(id: string) {
  const client = isValidObjectId(id) ? await ClientModel.findById(id).lean() : null
  if (!client) throw new ClientSiteError('This client was not found.', 404)
  return client
}

// A client's sites, removed ones included, and what their assessments are to
// the engineer, summed.
async function clientHolding(client: Types.ObjectId, userId: string) {
  const sites = await SiteModel.find({ client }, '_id name removed').lean()
  const held = await holdings(
    sites.map((s) => s._id),
    userId,
  )
  return { sites, held, total: sum(sites.map((s) => holdingOf(held, s))) }
}

// The body of PUT /api/clients/:id.
export const clientNameSchema = z.object({
  name: z
    .string('Client name is required.')
    .trim()
    .min(1, 'Client name is required.')
    .max(200, 'Client name must be 200 characters or fewer.'),
})

// Renames a client (CP-18), so every assessment for it shows the new name:
// only when every assessment at all its sites, archived or not, is the
// engineer's and none is finalised. A name another client has, whatever its
// case or spacing, is refused: that is a duplicate to merge (CP-44), not a
// rename. Its old name is kept for masking (PV-02).
export async function renameClient(id: string, name: string, user: SessionUser) {
  const client = await clientById(id)
  const { sites, total } = await clientHolding(client._id, user.id)
  const problem = refusal('client', total, { removed: !sites.some((s) => !s.removed) })
  if (problem) throw problem
  const next = tidy(name)
  if (next === client.name) return
  const key = clientKey(next)
  const taken = new ClientSiteFieldError('name', 'A client with this name already exists.')
  if (key !== client.key && (await ClientModel.exists({ key, _id: { $ne: client._id } })))
    throw taken
  const formerNames = formerWith(client.formerNames, client.name, next)
  try {
    await ClientModel.updateOne(
      { _id: client._id },
      {
        $set: {
          name: next,
          key,
          ...(formerNames.length && { formerNames }),
          edited: stamp(user),
        },
      },
    )
  } catch (error: unknown) {
    // Another client took the name between the check and the write.
    if (isDuplicateKeyError(error)) throw taken
    throw error
  }
}

// Removes a client (CP-18): all its listed sites, as one removal, so restoring
// the client brings back these and not a site removed on its own before. The
// client itself is not marked: one with no listed site counts as removed.
export async function removeClient(id: string, user: SessionUser) {
  const client = await clientById(id)
  const { sites, total } = await clientHolding(client._id, user.id)
  const problem = refusal('client', total, {
    removed: !sites.some((s) => !s.removed),
    removing: true,
  })
  if (problem) throw problem
  await SiteModel.updateMany(
    { client: client._id, ...LISTED },
    { $set: { removed: { ...stamp(user), withClient: true } } },
  )
}

// Restores the sites removed with the client (CP-18), and so the client. One
// whose name the client has since given another site stays removed, to restore
// on its own under a new name; it never makes two listed sites of one name.
export async function restoreClient(
  id: string,
  user: SessionUser,
): Promise<{ restored: number; nameTaken: string[] }> {
  const client = await clientById(id)
  const { sites, held } = await clientHolding(client._id, user.id)
  const batch = sites
    .filter((s) => s.removed?.withClient)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!batch.length) throw new ClientSiteError('No sites were removed with this client.', 409)
  const problem = restoreRefusal('client', sum(batch.map((s) => holdingOf(held, s))))
  if (problem) throw problem
  const nameTaken: string[] = []
  let restored = 0
  // One at a time, so each sees the names restored before it.
  for (const site of batch) {
    if (await siteNameTaken(client._id, site.name, site._id)) {
      nameTaken.push(site.name)
      continue
    }
    const { modifiedCount } = await SiteModel.updateOne(
      { _id: site._id, 'removed.withClient': true },
      { $unset: { removed: 1 } },
    )
    restored += modifiedCount
  }
  return { restored, nameTaken }
}

// The client page's rules for one client (CP-18), for the page's buttons.
export function clientRights(
  sites: { _id: Types.ObjectId; removed?: unknown }[],
  held: Map<string, Holding>,
) {
  const total = sum(sites.map((s) => holdingOf(held, s)))
  const removed = !sites.some((s) => !s.removed)
  const batch = sites.filter((s) => (s.removed as { withClient?: boolean } | undefined)?.withClient)
  return {
    removed,
    rename: allowedUnless(refusal('client', total, { removed })),
    remove: allowedUnless(refusal('client', total, { removed, removing: true })),
    removedWithClient: batch.length,
    restore: batch.length
      ? allowedUnless(restoreRefusal('client', sum(batch.map((s) => holdingOf(held, s)))))
      : { allowed: false, reason: null },
  }
}

// The client page's rules for one site (CP-18).
export function siteRights(
  site: { _id: Types.ObjectId; removed?: unknown },
  held: Map<string, Holding>,
) {
  const h = holdingOf(held, site)
  const removed = !!site.removed
  return {
    assessments: h.total,
    change: allowedUnless(refusal('site', h, { removed })),
    remove: allowedUnless(refusal('site', h, { removed, removing: true })),
    restore: removed ? allowedUnless(restoreRefusal('site', h)) : { allowed: false, reason: null },
  }
}
