import { beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { knownEntities } from '../services/privacy.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { oneAssessment } from './new-assessments'
import type request from 'supertest'

useMemoryMongo()

// CP-18: an engineer manages a client and its sites from the client page, but
// only where every assessment, archived or not, is theirs and none finalised.

const engineer = (name: string, staffId: string) => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId.toLowerCase()}@example.com`,
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = engineer('Alex Rowe', 'TEST-1')
const jide = engineer('Jide Okafor', 'TEST-2')
const api = signedInAs(app, alex)
const jideApi = signedInAs(app, jide)
beforeEach(async () => {
  await UserModel.create([alex, jide])
})

// Posts one assessment (CP-23's body) and answers with the one assessment it
// made, or with the refusal.
async function create(
  payload: Record<string, unknown>,
  as: { post: (url: string) => request.Test } = api,
) {
  const response = await as.post('/api/assessments').send(oneAssessment(payload))
  return { status: response.status, body: response.body.assessments?.[0] ?? response.body }
}

const KENT_RIDGE = {
  name: 'Kent Ridge campus',
  address: '21 Lower Kent Ridge Road',
  jurisdiction: 'SG',
  facilityType: 'Mixed-use development',
}
const BUKIT_TIMAH = { ...KENT_RIDGE, name: 'Bukit Timah campus', address: '1 Bukit Timah Road' }

type Api = typeof api

// A first visit to a new site of NUS, a new client unless one is given.
async function firstVisit(as: Api = api, site = KENT_RIDGE, clientId?: string) {
  const created = await create(
    { ...(clientId ? { clientId } : { client: 'NUS' }), site, siteVisitDate: '2025-03-10' },
    as,
  )
  expect(created.status).toBe(201)
  return {
    reference: created.body.reference as string,
    clientId: created.body.clientId as string,
    siteId: created.body.site.id as string,
  }
}

// A later visit to a listed site.
async function revisit(as: Api, clientId: string, siteId: string, siteVisitDate = '2026-03-12') {
  const created = await create(
    { clientId, siteId, surveyType: 'Follow-up visit', siteVisitDate },
    as,
  )
  expect(created.status).toBe(201)
  return created.body.reference as string
}

const archive = (as: Api, reference: string) =>
  as.post(`/api/assessments/${reference}/archive`).expect(204)
const finalise = (reference: string) =>
  AssessmentModel.updateOne({ reference }, { reportStatus: 'finalised' })
const page = async (clientId: string, as: Api = api) =>
  (await as.get(`/api/clients/${clientId}`)).body
// One assessment as the work list shows it to this engineer.
type Listed = Record<string, unknown> & {
  reference: string
  site: Record<string, unknown> & {
    change: { allowed: boolean; reason: string | null; assessments: number }
  }
}
const listed = async (reference: string, as: Api = api) =>
  ((await as.get('/api/assessments')).body as Listed[]).find((a) => a.reference === reference)!

describe('The client page (CP-18)', () => {
  it("lists the engineer's sites at the client with their own visits, newest first, and none of a colleague's", async () => {
    const first = await firstVisit()
    const second = await revisit(api, first.clientId, first.siteId)
    await archive(api, first.reference)
    // Jide's own site of NUS: not Alex's, so not listed.
    await firstVisit(jideApi, BUKIT_TIMAH, first.clientId)

    const shown = await page(first.clientId)
    expect(shown).toMatchObject({ id: first.clientId, name: 'NUS', removed: false })
    expect(shown.sites).toHaveLength(1)
    // CP-23: each visit also carries its type and report due date; the page counts its documents.
    expect(shown.sites[0].visits[0]).toMatchObject({
      surveyType: expect.any(String),
      reportDueDate: null,
    })
    expect(shown.documents).toBe(0)
    expect(shown.sites[0]).toMatchObject({
      id: first.siteId,
      ...KENT_RIDGE,
      assessments: 2,
      change: { allowed: true, reason: null },
      visits: [
        { reference: second, siteVisitDate: '2026-03-12', status: 'not_started' },
        { reference: first.reference, siteVisitDate: '2025-03-10', status: 'archived' },
      ],
    })
    // Jide's assessments count against renaming the client, without saying whose.
    expect(shown.rename).toEqual({
      allowed: false,
      reason: "Another engineer has assessments for this client, so it can't be changed.",
    })
  })

  it("lists the site contacts of the engineer's assessments there, latest first, each once", async () => {
    const first = await create({
      client: 'NUS',
      site: KENT_RIDGE,
      siteVisitDate: '2025-03-10',
      siteContacts: [{ name: 'Mei Tan', role: 'Facilities manager' }, { name: 'Raj Kumar' }],
    })
    const { clientId, site } = first.body
    await create({
      clientId,
      siteId: site.id,
      surveyType: 'Follow-up visit',
      siteVisitDate: '2026-03-12',
      siteContacts: [{ name: 'Mei Tan', role: 'Site lead' }],
    })
    // Jide's contact at his own site of NUS is not Alex's to see.
    await create(
      { clientId, site: BUKIT_TIMAH, siteVisitDate: '2026-04-01', siteContacts: [{ name: 'Lim' }] },
      jideApi,
    )

    expect((await page(clientId)).contacts).toEqual([
      { name: 'Mei Tan', role: 'Site lead', site: 'Kent Ridge campus' },
      { name: 'Raj Kumar', role: null, site: 'Kent Ridge campus' },
    ])
  })

  it('is refused for a client the engineer has no assessment for, an unknown one, and admins', async () => {
    const { clientId } = await firstVisit(jideApi)
    expect((await api.get(`/api/clients/${clientId}`)).status).toBe(403)
    expect((await api.get(`/api/clients/${new Types.ObjectId()}`)).status).toBe(404)
    expect((await api.get('/api/clients/not-an-id')).status).toBe(404)
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`/api/clients/${clientId}`)).status).toBe(403)
  })
})

describe('Correcting a site (CP-18)', () => {
  it('changes it for every assessment there, and observations keep the scope they were saved with', async () => {
    const first = await firstVisit()
    const second = await revisit(api, first.clientId, first.siteId)
    const saved = await ObservationModel.create({
      assessment: (await AssessmentModel.findOne({ reference: first.reference }))!._id,
      session: new Types.ObjectId(),
      engineer: alex.name,
      note: 'Riser not fire-stopped.',
      recordings: [],
      severity: 'high',
      location: new Types.ObjectId(),
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Mixed-use development',
        COPE_dimension: ['Construction'],
        effective_date: new Date(),
      },
    })

    const corrected = {
      ...KENT_RIDGE,
      name: 'Kent Ridge Campus (Main)',
      jurisdiction: 'MY',
      facilityType: 'Office',
    }
    expect((await api.put(`/api/sites/${first.siteId}`).send(corrected)).status).toBe(204)

    for (const reference of [first.reference, second])
      expect((await listed(reference)).site).toMatchObject(corrected)
    const observation = await ObservationModel.findById(saved._id).lean()
    expect(observation!.metadata).toMatchObject({
      jurisdiction: 'SG',
      facility_type: 'Mixed-use development',
    })
    expect((await page(first.clientId)).sites[0].edited).toMatchObject({
      by: { id: String(alex._id), name: 'Alex Rowe' },
    })
  })

  it('keeps its old name and address masked before AI calls, read back as the current ones (PV-02)', async () => {
    const { reference, siteId } = await firstVisit()
    // A change of case alone adds nothing: masking already ignores case.
    await api.put(`/api/sites/${siteId}`).send({ ...KENT_RIDGE, name: 'kent ridge CAMPUS' })
    await api.put(`/api/sites/${siteId}`).send({ ...KENT_RIDGE, name: 'Kent Ridge', address: '' })

    const entities = await knownEntities(reference)
    const site = await SiteModel.findById(siteId).lean()
    expect(entities).toContainEqual({
      type: 'SITE',
      names: ['Kent Ridge', site!.code, 'kent ridge CAMPUS'],
    })
    // The address was cleared, but notes written with it still mention it.
    expect(entities).toContainEqual({ type: 'ADDRESS', names: [KENT_RIDGE.address] })
  })

  it("is refused while a colleague's assessment uses it, archived or not, or a report there is finalised", async () => {
    const first = await firstVisit()
    const change = () =>
      api.put(`/api/sites/${first.siteId}`).send({ ...KENT_RIDGE, address: '1 Somewhere Else' })

    await finalise(first.reference)
    const finalised = await change()
    expect(finalised.status).toBe(409)
    expect(finalised.body.error).toBe("This site has a finalised report, so it can't be changed.")
    await AssessmentModel.updateOne({ reference: first.reference }, { $unset: { reportStatus: 1 } })

    const theirs = await revisit(jideApi, first.clientId, first.siteId)
    await archive(jideApi, theirs)
    const refused = await change()
    expect(refused.status).toBe(403)
    expect(refused.body.error).toBe(
      "Another engineer's assessment uses this site, so it can't be changed.",
    )
    expect((await listed(first.reference)).site).toMatchObject({
      address: KENT_RIDGE.address,
      change: { allowed: false, reason: refused.body.error, assessments: 2 },
    })
    expect((await SiteModel.findById(first.siteId).lean())!.address).toBe(KENT_RIDGE.address)
  })

  it("refuses another of the client's site names, and a site that isn't the engineer's", async () => {
    const first = await firstVisit()
    const bukit = await firstVisit(api, BUKIT_TIMAH, first.clientId)
    const taken = await api
      .put(`/api/sites/${bukit.siteId}`)
      .send({ ...BUKIT_TIMAH, name: 'KENT RIDGE campus' })
    expect(taken.status).toBe(400)
    expect(taken.body.fields).toEqual({ name: expect.stringMatching(/already has a site named/) })

    expect((await jideApi.put(`/api/sites/${first.siteId}`).send(KENT_RIDGE)).status).toBe(403)
    expect((await api.put(`/api/sites/${new Types.ObjectId()}`).send(KENT_RIDGE)).status).toBe(404)
  })

  it('can correct a site not yet linked to a client (CP-17), from its assessment', async () => {
    const site = await SiteModel.create({ code: 'SITE-OLD1', ...KENT_RIDGE })
    await AssessmentModel.create({
      reference: 'RPT-2025-0001',
      site: site._id,
      client: 'Old Client Ltd',
      surveyType: 'Property risk survey',
      engineer: alex._id,
    })
    expect((await listed('RPT-2025-0001')).site.change.allowed).toBe(true)
    const saved = await api
      .put(`/api/sites/${site._id}`)
      .send({ ...KENT_RIDGE, name: 'Kent Ridge' })
    expect(saved.status).toBe(204)
    expect((await listed('RPT-2025-0001')).site.name).toBe('Kent Ridge')
  })
})

describe('Renaming a client (CP-18)', () => {
  it('renames it for every assessment, keeping the old name masked', async () => {
    const first = await firstVisit()
    const renamed = await api
      .put(`/api/clients/${first.clientId}`)
      .send({ name: 'National University  of Singapore' })
    expect(renamed.status).toBe(204)

    expect((await listed(first.reference)).client).toBe('National University of Singapore')
    expect((await knownEntities(first.reference))[0]).toEqual({
      type: 'CLIENT',
      names: ['National University of Singapore', 'NUS'],
    })
    // Its new name finds it, so typing it on the create form adds no new client.
    await create({
      client: 'national university of singapore',
      site: BUKIT_TIMAH,
    })
    expect(await ClientModel.countDocuments()).toBe(1)
  })

  it("refuses another client's name, a colleague's assessment at any of its sites, and a finalised report", async () => {
    const first = await firstVisit()
    await create({
      client: 'SMU',
      site: KENT_RIDGE,
    })
    const rename = (name: string) => api.put(`/api/clients/${first.clientId}`).send({ name })

    const taken = await rename('smu')
    expect(taken.status).toBe(400)
    expect(taken.body.fields).toEqual({ name: 'A client with this name already exists.' })
    // A change of case is a rename of the same client.
    expect((await rename('Nus')).status).toBe(204)

    await finalise(first.reference)
    expect((await rename('NUS')).status).toBe(409)
    await AssessmentModel.updateOne({ reference: first.reference }, { $unset: { reportStatus: 1 } })

    const theirs = await firstVisit(jideApi, BUKIT_TIMAH, first.clientId)
    await archive(jideApi, theirs.reference)
    expect((await rename('NUS')).status).toBe(403)
    expect((await ClientModel.findById(first.clientId).lean())!.name).toBe('Nus')
  })
})

describe('Removing and restoring a site (CP-18)', () => {
  it('removes a site whose assessments are all archived, from the page and the create form, and restores it', async () => {
    const first = await firstVisit()
    const bukit = await firstVisit(api, BUKIT_TIMAH, first.clientId)

    const open = await api.post(`/api/sites/${bukit.siteId}/remove`)
    expect(open.status).toBe(409)
    expect(open.body.error).toBe(
      'This site has 1 open assessment. Archive it, then remove the site.',
    )

    await archive(api, bukit.reference)
    expect((await api.post(`/api/sites/${bukit.siteId}/remove`)).status).toBe(204)
    expect((await api.post(`/api/sites/${bukit.siteId}/remove`)).status).toBe(409)

    const sites = (await api.get(`/api/clients/${first.clientId}/sites`)).body
    expect(sites.map((s: { name: string }) => s.name)).toEqual([KENT_RIDGE.name])
    const onRemoved = await create({
      clientId: first.clientId,
      siteId: bukit.siteId,
      surveyType: 'Follow-up visit',
    })
    expect(onRemoved.status).toBe(400)
    expect(Object.keys(onRemoved.body.fields)).toEqual(['sites.0.id'])
    const removedSite = (await page(first.clientId)).sites.find(
      (s: { id: string }) => s.id === bukit.siteId,
    )
    expect(removedSite).toMatchObject({
      removed: { by: { name: 'Alex Rowe' } },
      removedWithClient: false,
      change: { allowed: false, reason: 'This site is removed. Restore it before changing it.' },
      restore: { allowed: true },
    })
    // Read-only until restored.
    expect((await api.put(`/api/sites/${bukit.siteId}`).send(BUKIT_TIMAH)).status).toBe(409)

    expect((await api.post(`/api/sites/${bukit.siteId}/restore`)).status).toBe(204)
    expect((await api.get(`/api/clients/${first.clientId}/sites`)).body).toHaveLength(2)
  })

  it("is refused while a colleague's assessment, even archived, is there", async () => {
    const first = await firstVisit()
    await archive(api, first.reference)
    const theirs = await revisit(jideApi, first.clientId, first.siteId)
    await archive(jideApi, theirs)
    expect((await api.post(`/api/sites/${first.siteId}/remove`)).status).toBe(403)
  })

  it('frees its name for a new site, and is then restored only under another name', async () => {
    const first = await firstVisit()
    const bukit = await firstVisit(api, BUKIT_TIMAH, first.clientId)
    await archive(api, bukit.reference)
    await api.post(`/api/sites/${bukit.siteId}/remove`).expect(204)
    // A colleague can't see the removed site, so its name doesn't stop theirs.
    const again = await firstVisit(jideApi, BUKIT_TIMAH, first.clientId)

    const plain = await api.post(`/api/sites/${bukit.siteId}/restore`)
    expect(plain.status).toBe(400)
    expect(plain.body.fields.name).toMatch(/now has another site named Bukit Timah campus/)
    expect(
      (await api.post(`/api/sites/${bukit.siteId}/restore`).send({ name: 'bukit timah CAMPUS' }))
        .status,
    ).toBe(400)
    expect(
      (await api.post(`/api/sites/${bukit.siteId}/restore`).send({ name: 'Bukit Timah (old)' }))
        .status,
    ).toBe(204)
    const restored = await SiteModel.findById(bukit.siteId).lean()
    expect(restored).toMatchObject({
      name: 'Bukit Timah (old)',
      formerNames: ['Bukit Timah campus'],
    })
    expect(again.siteId).not.toBe(bukit.siteId)
  })

  it('comes back when one of its archived assessments is restored, unless its name was taken', async () => {
    const first = await firstVisit()
    await archive(api, first.reference)
    await api.post(`/api/sites/${first.siteId}/remove`).expect(204)

    expect((await api.post(`/api/assessments/${first.reference}/restore`)).status).toBe(204)
    expect((await SiteModel.findById(first.siteId).lean())!.removed).toBeUndefined()

    await archive(api, first.reference)
    await api.post(`/api/sites/${first.siteId}/remove`).expect(204)
    await firstVisit(jideApi, KENT_RIDGE, first.clientId)
    const refused = await api.post(`/api/assessments/${first.reference}/restore`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(
      /Restore the site under another name from the client page first/,
    )
    expect((await listed(first.reference)).status).toBe('archived')
  })
})

describe('Removing and restoring a client (CP-18)', () => {
  it('says how many assessments are still open, naming the client (copy from board R11 · 4)', async () => {
    const first = await firstVisit()
    await firstVisit(api, BUKIT_TIMAH, first.clientId)
    const refused = await api.post(`/api/clients/${first.clientId}/remove`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe(
      'This client has 2 open assessments. Archive them, then remove the client.',
    )
    await archive(api, first.reference)
    expect((await page(first.clientId)).remove.reason).toBe(
      'This client has 1 open assessment. Archive it, then remove the client.',
    )
  })

  it('removes its listed sites as one, leaves the create form, and restores those alone', async () => {
    const first = await firstVisit()
    const bukit = await firstVisit(api, BUKIT_TIMAH, first.clientId)
    const third = await firstVisit(api, { ...KENT_RIDGE, name: 'Outram campus' }, first.clientId)
    for (const reference of [first.reference, bukit.reference, third.reference])
      await archive(api, reference)
    // Removed on its own first, so restoring the client leaves it removed.
    await api.post(`/api/sites/${third.siteId}/remove`).expect(204)

    expect((await api.post(`/api/clients/${first.clientId}/remove`)).status).toBe(204)
    expect((await api.post(`/api/clients/${first.clientId}/remove`)).status).toBe(409)
    expect((await api.get('/api/clients')).body).toEqual([])
    expect(await page(first.clientId)).toMatchObject({
      removed: true,
      removedWithClient: 2,
      restore: { allowed: true },
      rename: { allowed: false, reason: 'This client is removed. Restore it before changing it.' },
    })

    expect((await api.post(`/api/clients/${first.clientId}/restore`)).body).toEqual({
      restored: 2,
      nameTaken: [],
    })
    const names = (await api.get(`/api/clients/${first.clientId}/sites`)).body.map(
      (s: { name: string }) => s.name,
    )
    expect(names).toEqual([BUKIT_TIMAH.name, KENT_RIDGE.name])
  })

  it('comes back when its name is typed again, and holds back a site whose name was taken', async () => {
    const first = await firstVisit()
    await archive(api, first.reference)
    await api.post(`/api/clients/${first.clientId}/remove`).expect(204)

    // Typing its name finds it rather than adding a second NUS.
    const again = await create({ client: 'nus', site: KENT_RIDGE }, jideApi)
    expect(again.body.clientId).toBe(first.clientId)

    expect((await api.post(`/api/clients/${first.clientId}/restore`)).body).toEqual({
      restored: 0,
      nameTaken: [KENT_RIDGE.name],
    })
  })
})

describe('The work list (CP-18)', () => {
  it('says whether the engineer may correct each site, and why not', async () => {
    const first = await firstVisit()
    expect(await listed(first.reference)).toMatchObject({
      site: { removed: false, change: { allowed: true, reason: null, assessments: 1 } },
    })
    // A colleague's site at the same client leaves this one the engineer's.
    await firstVisit(jideApi, BUKIT_TIMAH, first.clientId)
    expect((await listed(first.reference)).site.change.allowed).toBe(true)
    // A colleague's visit to it doesn't.
    await revisit(jideApi, first.clientId, first.siteId)
    expect((await listed(first.reference)).site.change).toEqual({
      allowed: false,
      reason: "Another engineer's assessment uses this site, so it can't be changed.",
      assessments: 2,
    })
  })
})
