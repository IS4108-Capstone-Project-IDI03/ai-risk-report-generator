// Creates one client's sites and assessments together (CP-23): the New
// assessment form, filled in by hand or from client documents. Called by
// routes/assessment.routes.ts (POST /api/assessments) and
// client-intake-create.service.ts. Calls client.service.ts (find or add the
// client, duplicate-site rules) and assessment.service.ts (codes, DTOs).
import { z } from 'zod'
import { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel, type ISite } from '../models/site.model'
import type { SessionUser } from './auth.service'
import {
  dueDateRule,
  dueOnOrAfterVisit,
  insertWithNextCode,
  objectId,
  optional,
  optionalDate,
  pad,
  required,
  toDto,
  visitType,
  type AssessmentDto,
} from './assessment.service'
import {
  changeRights,
  clientKey,
  FACILITY_TYPE_RULE,
  findOrCreateClient,
  getClient,
  latestVisit,
  siteNameTaken,
  UnknownClientError,
} from './client.service'
import { FACILITY_TYPES } from './knowledge-document.service'

// A ref names a site or assessment within one request, e.g. "site-1", so a
// client document can be placed under it before it has an id. Used as a key
// in an intake's `created` ledger, so no dots or dollar signs.
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'A ref is letters, digits, - and _ only.')

const newVisitSchema = z
  .object({
    ref,
    visitType,
    siteVisitDate: optionalDate('Site visit date'),
    // The last day of a visit over several days.
    siteVisitEndDate: optionalDate('Last survey day'),
    reportDueDate: optionalDate('Report due date'),
    siteContacts: z
      .array(z.object({ name: required('Contact name'), role: optional('Contact role') }))
      .max(20, 'List at most 20 site contacts.')
      .default([]),
  })
  .refine(
    (a) => !a.siteVisitEndDate || (!!a.siteVisitDate && a.siteVisitEndDate >= a.siteVisitDate),
    {
      message: 'The last survey day must be on or after the site visit date.',
      path: ['siteVisitEndDate'],
    },
  )
  .refine(dueOnOrAfterVisit, dueDateRule)

// A listed site (`id`) or a new one (its details, address included).
const siteEntrySchema = z
  .object({
    ref,
    id: objectId("Choose one of this client's sites, or add a new one.").optional(),
    // On a listed site, copy its latest visit's locations (CP-17 AC5).
    copyLocations: z.boolean().default(true),
    name: optional('Site name'),
    address: optional('Site address'),
    jurisdiction: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Jurisdiction must be a two-letter code, e.g. SG.')
      .optional(),
    facilityType: z
      .string()
      .refine((type) => FACILITY_TYPES.includes(type), FACILITY_TYPE_RULE)
      .optional(),
    assessments: z
      .array(newVisitSchema)
      .min(1, 'Add at least one assessment.')
      .max(20, 'Add at most 20 assessments to one site.'),
  })
  .superRefine((site, ctx) => {
    if (site.id) return
    const needed = {
      name: 'Site name is required.',
      address: 'Site address is required.',
      jurisdiction: 'Jurisdiction is required.',
      facilityType: 'Facility type is required.',
    }
    for (const [key, message] of Object.entries(needed))
      if (!site[key as keyof typeof needed]) ctx.addIssue({ code: 'custom', path: [key], message })
  })

/** The body of POST /api/assessments (CP-23): one client, its sites, their assessments. */
export const newAssessmentsSchema = z
  .object({
    client: z
      .object(
        {
          id: objectId('Choose one of the listed clients, or name a new one.').optional(),
          name: optional('Client'),
          division: optional('Division'),
        },
        'Client is required.',
      )
      .refine((c) => !!c.id !== !!c.name, { message: 'Client is required.', path: ['name'] }),
    sites: z
      .array(siteEntrySchema, 'Add at least one site.')
      .min(1, 'Add at least one site.')
      .max(50, 'Add at most 50 sites at once.'),
  })
  .superRefine(({ sites }, ctx) => {
    // Refs must be unique, or a document could be placed under the wrong one.
    const refs = new Set<string>()
    const names = new Set<string>()
    sites.forEach((site, i) => {
      for (const [path, r] of [
        [['sites', i, 'ref'], site.ref],
        ...site.assessments.map((a, j) => [['sites', i, 'assessments', j, 'ref'], a.ref]),
      ] as [(string | number)[], string][]) {
        if (refs.has(r)) ctx.addIssue({ code: 'custom', path, message: `${r} is used twice.` })
        refs.add(r)
      }
      // Two new sites of one name would break the client's one-name rule (CP-17 AC10).
      if (site.name && !site.id) {
        const key = clientKey(site.name)
        if (names.has(key))
          ctx.addIssue({
            code: 'custom',
            path: ['sites', i, 'name'],
            message: `${site.name} is listed twice. Add its assessments to one site.`,
          })
        names.add(key)
      }
    })
  })

export type NewAssessments = z.infer<typeof newAssessmentsSchema>

// Request values refused against the database, by field path, e.g.
// { "sites.0.id": "..." }. The route answers 400 with them.
export class AssessmentFieldsError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields)[0])
    this.name = 'AssessmentFieldsError'
  }
}

type StoredSite = ISite & { _id: Types.ObjectId }

// Checks every value against the database before anything is written, so a
// refused request leaves no trace: the client and listed sites exist, new site
// names are free, and a site with no earlier assessment starts with a First
// survey (AC20). Returns the listed sites and the client, if it is recorded.
async function checkAgainstRecords(input: NewAssessments) {
  const fields: Record<string, string> = {}
  let client = null
  if (input.client.id) {
    try {
      client = await getClient(input.client.id)
    } catch (error) {
      if (!(error instanceof UnknownClientError)) throw error
      fields['client.id'] = error.message
    }
  } else {
    client = await ClientModel.findOne({ key: clientKey(input.client.name!) }).lean()
  }
  const listed = new Map<string, StoredSite>()
  const visited = new Set<string>()
  for (const [i, site] of input.sites.entries()) {
    let hasEarlier = false
    if (site.id) {
      const found = client && (await SiteModel.findById(site.id).lean())
      if (!client) {
        // An unknown client is named once, on its own field.
        if (!fields['client.id'])
          fields[`sites.${i}.id`] = 'A new client has no sites yet. Add a new site.'
      } else if (!found || !client!._id.equals(found.client) || found.removed)
        fields[`sites.${i}.id`] = "Choose one of this client's sites, or add a new one."
      else listed.set(site.id, found)
      hasEarlier = visited.has(site.id) || !!(await AssessmentModel.exists({ site: site.id }))
      visited.add(site.id)
    } else if (client && (await siteNameTaken(client._id, site.name!)))
      fields[`sites.${i}.name`] =
        `This client already has a site named ${site.name}. Choose it from the list instead.`
    if (!hasEarlier && site.assessments[0].visitType !== 'First survey')
      fields[`sites.${i}.assessments.0.visitType`] =
        'A site with no earlier assessment starts with a First survey.'
  }
  if (Object.keys(fields).length) throw new AssessmentFieldsError(fields)
  return { listed, recorded: client }
}

// An id for every new site and every assessment, by ref, chosen before
// anything is made so a failure knows what to remove.
function plan(input: NewAssessments) {
  const pick = (refs: string[]) =>
    Object.fromEntries(refs.map((r) => [r, String(new Types.ObjectId())]))
  return {
    siteIds: pick(input.sites.filter((s) => !s.id).map((s) => s.ref)),
    assessmentIds: pick(input.sites.flatMap((s) => s.assessments.map((a) => a.ref))),
  }
}

/** What a create made: the client's id and the new sites' and assessments' ids, by ref. */
export type Made = {
  clientId: string
  siteIds: Record<string, string>
  assessmentIds: Record<string, string>
}

export type CreatedAssessments = { clientId: string; assessments: AssessmentDto[] }

// 'YYYY-MM-DD' parses as UTC midnight, so the calendar day is kept.
const day = (date?: string) => (date ? new Date(date) : undefined)

/**
 * Finds or adds the client, adds each new site and each assessment, assigned
 * to the signed-in engineer, in steps a-f. `then` runs once they exist (the
 * intake keeps its documents there). Returns the client's id and the
 * assessments in request order. A failure, in `then` too, removes what this
 * call made, so nothing is left half created. Throws AssessmentFieldsError
 * (400) before writing anything.
 */
export async function createAll(
  input: NewAssessments,
  user: SessionUser,
  then?: (made: Made) => Promise<void>,
): Promise<CreatedAssessments> {
  // a. Check.
  const { listed, recorded } = await checkAgainstRecords(input)

  // b. The client, and c. the ids.
  const client = input.client.id
    ? recorded!
    : await findOrCreateClient(input.client.name!, input.client.division)
  const ids = plan(input)
  const year = new Date().getUTCFullYear()
  const planned = Object.values(ids.assessmentIds).map((id) => new Types.ObjectId(id))
  try {
    // d. The new sites.
    const sites: StoredSite[] = []
    for (const entry of input.sites) {
      if (entry.id) {
        sites.push(listed.get(entry.id)!)
        continue
      }
      const { name, address, jurisdiction, facilityType } = entry
      const site = await insertWithNextCode(
        'site',
        (n) => `SITE-${pad(n)}`,
        (code) =>
          SiteModel.create({
            _id: ids.siteIds[entry.ref],
            code,
            name,
            address,
            jurisdiction,
            facilityType,
            client: client._id,
          }),
      )
      sites.push(site.toObject())
    }
    // e. The assessments.
    for (const [i, entry] of input.sites.entries()) {
      const site = sites[i]
      // Copied from the latest visit before this request (CP-17 AC5), each a new id.
      const copied = entry.id && entry.copyLocations ? await latestVisit(site._id, planned) : null
      for (const visit of entry.assessments) {
        await insertWithNextCode(
          `assessment:${year}`,
          (n) => `RPT-${year}-${pad(n)}`,
          (reference) =>
            AssessmentModel.create({
              _id: ids.assessmentIds[visit.ref],
              reference,
              site: site._id,
              surveyType: visit.visitType,
              siteVisitDate: day(visit.siteVisitDate),
              siteVisitEndDate: day(visit.siteVisitEndDate),
              reportDueDate: day(visit.reportDueDate),
              siteContacts: visit.siteContacts,
              engineer: new Types.ObjectId(user.id),
              locations: (copied?.locations ?? []).map(({ building, floor, name, key }) => ({
                building,
                floor,
                name,
                key,
              })),
            }),
        )
      }
    }
    // f. What the caller keeps with them.
    // Named before `then` keeps documents: a failure here must not orphan them.
    const assessments = await dtosOf(planned, sites, client, user)
    await then?.({ clientId: String(client._id), ...ids })
    return { clientId: String(client._id), assessments }
  } catch (error) {
    // No transaction (dev and test MongoDB are standalone servers), so a failed
    // create removes what it made by hand; without this, the form's "Nothing
    // created" would be wrong and a retry refused for the site names it took.
    await removeMade(ids, recorded ? null : client._id).catch((cleanupError: unknown) =>
      console.error('Could not remove what a failed create made:', cleanupError),
    )
    throw error
  }
}

// Deletes the planned assessments and new sites, and the client when this
// create added it and no other site has since joined it.
async function removeMade(ids: Omit<Made, 'clientId'>, addedClient: Types.ObjectId | null) {
  await Promise.all([
    AssessmentModel.deleteMany({ _id: { $in: Object.values(ids.assessmentIds) } }),
    SiteModel.deleteMany({ _id: { $in: Object.values(ids.siteIds) } }),
  ])
  if (addedClient && !(await SiteModel.exists({ client: addedClient })))
    await ClientModel.deleteOne({ _id: addedClient })
}

/** Returns what an earlier create made, the assessments in request order, for a repeated request. */
export async function createdBefore(
  clientId: string,
  assessmentIds: string[],
  user: SessionUser,
): Promise<CreatedAssessments> {
  const client = await getClient(clientId)
  const ids = assessmentIds.map((id) => new Types.ObjectId(id))
  const sites = await SiteModel.find({
    _id: { $in: await AssessmentModel.distinct('site', { _id: { $in: ids } }) },
  }).lean()
  return { clientId, assessments: await dtosOf(ids, sites, client, user) }
}

// The created assessments, in request order, as the work list shows them.
async function dtosOf(
  ids: Types.ObjectId[],
  sites: StoredSite[],
  client: { _id: Types.ObjectId; name: string },
  user: SessionUser,
) {
  const stored = await AssessmentModel.find({ _id: { $in: ids } }).lean()
  const shown = sites.map((site) => ({ ...site, client }))
  const rights = await changeRights(shown, user.id)
  const engineer = { _id: user.id, name: user.name }
  return ids.flatMap((id) => {
    const a = stored.find((s) => s._id.equals(id))
    const site = a && shown.find((s) => s._id.equals(a.site))
    return a && site ? [toDto(a, site, engineer, rights(site))] : []
  })
}
