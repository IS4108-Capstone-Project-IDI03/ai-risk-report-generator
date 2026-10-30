import { beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// CP-17: a client has many sites, and a site many assessments, one per visit.

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

const KENT_RIDGE = {
  name: 'Kent Ridge campus',
  address: '21 Lower Kent Ridge Road',
  jurisdiction: 'SG',
  facilityType: 'Mixed-use development',
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    client: 'NUS',
    site: KENT_RIDGE,
    surveyType: 'Property risk survey',
    siteVisitDate: '2025-03-10',
    engineerId: String(alex._id),
    ...overrides,
  }
}

// A first visit by Jide, on a new site of a new client, with its locations.
async function firstVisit() {
  const created = await jideApi
    .post('/api/assessments')
    .send(body({ engineerId: String(jide._id) }))
  const { reference, clientId, site } = created.body
  for (const location of [
    { building: 'Block A', floor: 'L2', name: 'Staircase' },
    { building: 'Block A', name: 'Facade' },
    { building: 'Block B', floor: 'Ground', name: 'Lobby' },
    { name: 'Fire access route' },
  ])
    await jideApi.post(`/api/assessments/${reference}/locations`).send(location)
  return { reference, clientId: clientId as string, siteId: site.id as string }
}

// A later visit by Alex to a listed site.
function revisit(clientId: string, siteId: string, overrides: Record<string, unknown> = {}) {
  return api.post('/api/assessments').send({
    clientId,
    siteId,
    surveyType: 'Property risk survey',
    siteVisitDate: '2026-03-12',
    engineerId: String(alex._id),
    ...overrides,
  })
}

const places = (locations: { building?: string; floor?: string; name: string }[]) =>
  locations.map((l) => [l.building ?? null, l.floor ?? null, l.name])

describe('Clients and their sites (CP-17 AC3, AC4)', () => {
  it("lists every client, whoever added it, in name order with each one's site count", async () => {
    await firstVisit()
    await api.post('/api/assessments').send(body({ client: 'changi airport group' }))

    // Alex sees NUS, though only Jide has assessed it.
    expect((await api.get('/api/clients')).body).toEqual([
      { id: expect.any(String), name: 'changi airport group', sites: 1 },
      { id: expect.any(String), name: 'NUS', sites: 1 },
    ])
  })

  it("lists a client's sites, each with its latest visit not archived and what it would copy", async () => {
    const { clientId, siteId } = await firstVisit()
    // A later visit, archived: it was made by mistake, so it is not the latest.
    const mistake = await revisit(clientId, siteId, { siteVisitDate: '2026-05-01' })
    await api.post(`/api/assessments/${mistake.body.reference}/archive`)
    await api
      .post('/api/assessments')
      .send(
        body({ clientId, client: undefined, site: { ...KENT_RIDGE, name: 'Bukit Timah campus' } }),
      )

    const sites = (await api.get(`/api/clients/${clientId}/sites`)).body
    expect(sites).toEqual([
      {
        id: expect.any(String),
        code: expect.any(String),
        ...KENT_RIDGE,
        name: 'Bukit Timah campus',
        latest: {
          reference: expect.any(String),
          siteVisitDate: '2025-03-10',
          locations: 0,
          buildings: 0,
        },
      },
      {
        id: siteId,
        code: expect.any(String),
        ...KENT_RIDGE,
        latest: {
          reference: expect.stringMatching(/^RPT-/),
          siteVisitDate: '2025-03-10',
          locations: 4,
          buildings: 2,
        },
      },
    ])
    expect(sites[1].latest.reference).not.toBe(mistake.body.reference)
  })

  it('answers 404 for an unknown client, and only to those who create assessments', async () => {
    expect((await api.get(`/api/clients/${new Types.ObjectId()}/sites`)).status).toBe(404)
    expect((await api.get('/api/clients/not-an-id/sites')).status).toBe(404)
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get('/api/clients')).status).toBe(403)
  })
})

describe('Starting an assessment on a listed site (CP-17 AC5, AC7)', () => {
  it("copies the latest visit's locations, each its own, and no observations", async () => {
    const first = await firstVisit()

    const created = await revisit(first.clientId, first.siteId)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      client: 'NUS',
      clientId: first.clientId,
      site: { id: first.siteId, ...KENT_RIDGE },
    })

    const [before, after] = await Promise.all(
      [first.reference, created.body.reference].map((reference) =>
        AssessmentModel.findOne({ reference }).lean(),
      ),
    )
    expect(places(after!.locations)).toEqual(places(before!.locations))
    expect(places(after!.locations)).toContainEqual(['Block A', 'Level 2', 'Staircase'])
    // New ids, so editing or removing one leaves last year's as it was (AC7).
    const ids = new Set(before!.locations.map((l) => String(l._id)))
    expect(after!.locations.some((l) => ids.has(String(l._id)))).toBe(false)
    const staircase = after!.locations.find((l) => l.name === 'Staircase')!
    const edit = await api
      .patch(`/api/assessments/${created.body.reference}/locations/${staircase._id}`)
      .send({ building: 'Block A', floor: 'Level 3', name: 'Staircase' })
    expect(edit.status).toBe(200)
    const removed = after!.locations.find((l) => l.name === 'Facade')!
    await api.delete(`/api/assessments/${created.body.reference}/locations/${removed._id}`)
    const unchanged = await AssessmentModel.findOne({ reference: first.reference }).lean()
    expect(places(unchanged!.locations)).toEqual(places(before!.locations))
  })

  it('starts with no locations when the engineer unticks the copy', async () => {
    const { clientId, siteId } = await firstVisit()

    const created = await revisit(clientId, siteId, { copyLocations: false })
    expect(created.status).toBe(201)
    const stored = await AssessmentModel.findOne({ reference: created.body.reference }).lean()
    expect(stored!.locations).toEqual([])
  })

  it("refuses another client's site, an unknown client, and a listed site for a new client", async () => {
    const { siteId } = await firstVisit()
    const other = await api.post('/api/assessments').send(body({ client: 'SMU' }))

    const wrong = await revisit(other.body.clientId, siteId)
    expect(wrong.status).toBe(400)
    expect(wrong.body.fields).toEqual({
      siteId: "Choose one of this client's sites, or add a new one.",
    })

    const unknown = await revisit(String(new Types.ObjectId()), siteId)
    expect(unknown.status).toBe(400)
    expect(Object.keys(unknown.body.fields)).toEqual(['clientId'])

    const newClient = await api
      .post('/api/assessments')
      .send({ ...body({ site: undefined }), siteId })
    expect(newClient.status).toBe(400)
    expect(newClient.body.fields).toEqual({
      siteId: 'A new client has no sites yet. Add a new site.',
    })

    expect(await AssessmentModel.countDocuments()).toBe(2)
  })

  it('needs a client and a site, each listed or new but not both', async () => {
    const neither = await api
      .post('/api/assessments')
      .send(body({ client: undefined, site: undefined }))
    expect(neither.status).toBe(400)
    expect(neither.body.fields).toMatchObject({
      client: 'Client is required.',
      site: 'Site details are required.',
    })
  })
})

describe("A client's site names (CP-17 AC10)", () => {
  it('refuses a new site named like one the client has, whatever its case', async () => {
    const { clientId } = await firstVisit()

    const again = await api
      .post('/api/assessments')
      .send(
        body({ clientId, client: undefined, site: { ...KENT_RIDGE, name: 'KENT RIDGE CAMPUS' } }),
      )
    expect(again.status).toBe(400)
    expect(again.body.fields['site.name']).toMatch(/already has a site named KENT RIDGE CAMPUS/)
    // By typed name too: NUS is the same client.
    expect((await api.post('/api/assessments').send(body({ client: 'nus' }))).status).toBe(400)
    // Another client may have a site of that name.
    expect((await api.post('/api/assessments').send(body({ client: 'SMU' }))).status).toBe(201)
    expect(await SiteModel.countDocuments()).toBe(2)
  })

  it("refuses renaming a site to another of the client's site names", async () => {
    const { clientId } = await firstVisit()
    const bukit = { ...KENT_RIDGE, name: 'Bukit Timah campus' }
    const second = await api
      .post('/api/assessments')
      .send(body({ clientId, client: undefined, site: bukit }))

    const renamed = await api
      .put(`/api/assessments/${second.body.reference}`)
      .send({ ...body(), site: { ...bukit, name: 'kent ridge campus' } })
    expect(renamed.status).toBe(400)
    expect(Object.keys(renamed.body.fields)).toEqual(['site.name'])
  })
})

describe("A shared site's details (CP-17 AC8)", () => {
  it('locks them once the site has another assessment not archived, and unlocks them when it is archived', async () => {
    const first = await firstVisit()
    const listedFor = async (as: typeof api, reference: string) =>
      (
        (await as.get('/api/assessments')).body as { reference: string; siteShared: boolean }[]
      ).find((a) => a.reference === reference)!
    expect((await listedFor(jideApi, first.reference)).siteShared).toBe(false)

    const second = await revisit(first.clientId, first.siteId)
    expect(second.body.siteShared).toBe(true)
    expect((await listedFor(jideApi, first.reference)).siteShared).toBe(true)

    const edit = (site: typeof KENT_RIDGE, surveyType = 'Property risk survey') =>
      api.put(`/api/assessments/${second.body.reference}`).send({ site, surveyType })
    const moved = await edit({ ...KENT_RIDGE, address: '1 Somewhere Else' })
    expect(moved.status).toBe(409)
    expect(moved.body.error).toMatch(/other assessments/)
    // The rest of the assessment can still be corrected, with the site as it is.
    expect((await edit(KENT_RIDGE, 'Follow-up survey')).status).toBe(204)
    const site = await SiteModel.findById(first.siteId).lean()
    expect(site!.address).toBe(KENT_RIDGE.address)

    // Once the other visit is archived, the site is this assessment's alone.
    await jideApi.post(`/api/assessments/${first.reference}/archive`)
    expect((await listedFor(api, second.body.reference)).siteShared).toBe(false)
    expect((await edit({ ...KENT_RIDGE, address: '1 Somewhere Else' })).status).toBe(204)
  })
})

describe('Reading the client through its site (CP-17)', () => {
  it('names it on the capture screen, and the typed name for a site not yet migrated', async () => {
    const { reference } = await firstVisit()
    const capture = await jideApi.post(`/api/assessments/${reference}/capture-session`)
    expect(capture.body.assessment.client).toBe('NUS')
    expect(await ClientModel.countDocuments()).toBe(1)

    // Saved before CP-17: the site has no client yet.
    const site = await SiteModel.create({ code: 'SITE-OLD1', ...KENT_RIDGE })
    await AssessmentModel.create({
      reference: 'RPT-2025-0001',
      site: site._id,
      client: 'Old Client Ltd',
      surveyType: 'Property risk survey',
      engineer: alex._id,
    })
    const [listed] = (await api.get('/api/assessments')).body
    expect(listed).toMatchObject({
      reference: 'RPT-2025-0001',
      client: 'Old Client Ltd',
      clientId: null,
    })
  })
})
