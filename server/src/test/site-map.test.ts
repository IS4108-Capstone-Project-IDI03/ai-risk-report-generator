// CP-26: a site's location and block pins, through POST /api/assessments and
// PUT /api/sites/:id/map, read back from the work list.
import { beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { oneAssessment } from './new-assessments'

useMemoryMongo()

// CP-26: a site's location and its block pins, saved on the site so every
// visit there shows them.

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
const SPOT = { lat: 1.2966, lng: 103.852 }

async function firstVisit(site: Record<string, unknown> = KENT_RIDGE) {
  const response = await api
    .post('/api/assessments')
    .send(oneAssessment({ client: 'NUS', site, siteVisitDate: '2025-03-10' }))
  return { status: response.status, body: response.body.assessments?.[0] ?? response.body }
}
// The site as the engineer's work list shows it.
const shown = async (reference: string) =>
  (await api.get('/api/assessments')).body.find(
    (a: { reference: string }) => a.reference === reference,
  ).site

describe('a location on the create form (CP-26 AC1-4)', () => {
  it('saves a new site with its coordinates', async () => {
    const { status, body } = await firstVisit({ ...KENT_RIDGE, coordinates: SPOT })
    expect(status).toBe(201)
    expect(body.site.coordinates).toEqual(SPOT)
    expect(body.site.pins).toEqual([])
  })

  it('saves a new site without coordinates as before', async () => {
    const { status, body } = await firstVisit()
    expect(status).toBe(201)
    expect(body.site.coordinates).toBeNull()
  })

  it.each([
    ['latitude', { lat: 91, lng: 103 }],
    ['longitude', { lat: 1, lng: 181 }],
  ])('refuses a %s out of range, naming the field', async (_name, coordinates) => {
    const { status, body } = await firstVisit({ ...KENT_RIDGE, coordinates })
    expect(status).toBe(400)
    expect(Object.keys(body.fields).join()).toContain('sites.0.coordinates')
    expect(await SiteModel.countDocuments()).toBe(0)
  })
})

describe('changing a site map (CP-26 AC6, 7, 10-12)', () => {
  const change = (id: string, body: object, as = api) => as.put(`/api/sites/${id}/map`).send(body)

  it('adds a location to a site that has none, shown on the assessment', async () => {
    const { body } = await firstVisit()
    expect((await change(body.site.id, { coordinates: SPOT })).status).toBe(204)
    expect((await shown(body.reference)).coordinates).toEqual(SPOT)
  })

  it('removes the location, keeping the pins', async () => {
    const { body } = await firstVisit({ ...KENT_RIDGE, coordinates: SPOT })
    await change(body.site.id, { block: 'Block A', point: SPOT })
    expect((await change(body.site.id, { coordinates: null })).status).toBe(204)
    const site = await shown(body.reference)
    expect(site.coordinates).toBeNull()
    expect(site.pins).toEqual([{ name: 'Block A', ...SPOT }])
  })

  it('removes one block pin, keeping the others', async () => {
    const { body } = await firstVisit()
    await change(body.site.id, { block: 'Block A', point: SPOT })
    await change(body.site.id, { block: 'Block B', point: SPOT })
    expect((await change(body.site.id, { block: 'block a', point: null })).status).toBe(204)
    expect((await shown(body.reference)).pins).toEqual([{ name: 'Block B', ...SPOT }])
  })

  it('shows a block pin on a later visit to the site', async () => {
    const { body } = await firstVisit()
    await change(body.site.id, { block: 'Block A', point: SPOT })
    const later = await api.post('/api/assessments').send(
      oneAssessment({
        clientId: body.clientId,
        siteId: body.site.id,
        surveyType: 'Follow-up visit',
        siteVisitDate: '2026-03-12',
      }),
    )
    expect(later.status).toBe(201)
    expect(later.body.assessments[0].site.pins).toEqual([{ name: 'Block A', ...SPOT }])
  })

  it('moves a block in place, ignoring case, so the pins keep their order', async () => {
    const { body } = await firstVisit()
    await change(body.site.id, { block: 'Block A', point: { lat: 1, lng: 103 } })
    await change(body.site.id, { block: 'Block B', point: SPOT })
    await change(body.site.id, { block: ' block a', point: SPOT })
    expect((await shown(body.reference)).pins).toEqual([
      { name: 'block a', ...SPOT },
      { name: 'Block B', ...SPOT },
    ])
  })

  it("keeps a colleague's pin when another block is pinned from an older view", async () => {
    const { body } = await firstVisit()
    await AssessmentModel.create({
      reference: 'RPT-2026-9002',
      site: body.site.id,
      surveyType: 'Resurvey',
      siteVisitDate: new Date('2026-03-12'),
      engineer: jide._id,
    })
    await change(body.site.id, { block: 'Block C', point: SPOT }, jideApi)
    await change(body.site.id, { block: 'Block A', point: SPOT })
    expect((await shown(body.reference)).pins.map((p: { name: string }) => p.name)).toEqual([
      'Block C',
      'Block A',
    ])
  })

  it('refuses a pin out of range or a muddled change, naming it, and changes nothing', async () => {
    const { body } = await firstVisit({ ...KENT_RIDGE, coordinates: SPOT })
    const refused = await change(body.site.id, { block: 'Block A', point: { lat: 91, lng: 103 } })
    expect(refused.status).toBe(400)
    expect((await change(body.site.id, { pins: [] })).status).toBe(400)
    const site = await shown(body.reference)
    expect(site.coordinates).toEqual(SPOT)
    expect(site.pins).toEqual([])
  })

  it('lets an engineer change it from any of their visits, even with a colleague there', async () => {
    const { body } = await firstVisit()
    await AssessmentModel.create({
      reference: 'RPT-2026-9001',
      site: body.site.id,
      surveyType: 'Resurvey',
      siteVisitDate: new Date('2026-03-12'),
      engineer: jide._id,
    })
    const url = `/api/sites/${body.site.id}/map`
    expect((await jideApi.put(url).send({ coordinates: SPOT })).status).toBe(204)
  })

  it('refuses an engineer with no assessment there, a knowledge admin, and an unknown site', async () => {
    const { body } = await firstVisit()
    const url = `/api/sites/${body.site.id}/map`
    const map = { coordinates: SPOT }
    expect((await jideApi.put(url).send(map)).status).toBe(403)
    expect((await signedInAsRole(app, 'knowledge_admin').put(url).send(map)).status).toBe(403)
    expect((await api.put(`/api/sites/${new Types.ObjectId()}/map`).send(map)).status).toBe(404)
    expect((await SiteModel.findById(body.site.id).lean())?.coordinates).toBeUndefined()
  })

  it('refuses a change to a removed site', async () => {
    const { body } = await firstVisit()
    await SiteModel.updateOne(
      { _id: body.site.id },
      { removed: { at: new Date(), by: { id: 'x', name: 'x' } } },
    )
    const refused = await api.put(`/api/sites/${body.site.id}/map`).send({ coordinates: SPOT })
    expect(refused.status).toBe(409)
  })
})

describe('the map key (CP-26 AC13)', () => {
  it('gives a signed-in user the key, or null when none is set', async () => {
    const before = config.googleMapsBrowserKey
    config.googleMapsBrowserKey = 'test-key'
    expect((await api.get('/api/sites/map-config')).body).toEqual({ key: 'test-key' })
    config.googleMapsBrowserKey = undefined
    expect((await api.get('/api/sites/map-config')).body).toEqual({ key: null })
    config.googleMapsBrowserKey = before
  })
})

// CP-26: an engineer's position saved on a location, through POST and PATCH
// /api/assessments/:reference/locations.
describe('coordinates on a location (CP-26 AC22-25)', () => {
  const LOBBY = { building: 'Block A', floor: 'Level 1', name: 'Lobby' }
  const OTHER_SPOT = { lat: 1.3, lng: 103.86 }
  const locationsOf = (reference: string) => `/api/assessments/${reference}/locations`

  it('saves them on the location, and the first in a block sets its pin', async () => {
    const { body } = await firstVisit()
    const added = await api.post(locationsOf(body.reference)).send({ ...LOBBY, coordinates: SPOT })
    expect(added.status).toBe(201)
    expect(added.body.coordinates).toEqual(SPOT)
    expect((await shown(body.reference)).pins).toEqual([{ name: 'Block A', ...SPOT }])
  })

  it('leaves a block pin alone once it has one, whatever the case', async () => {
    const { body } = await firstVisit()
    await api.post(locationsOf(body.reference)).send({ ...LOBBY, coordinates: SPOT })
    await api
      .post(locationsOf(body.reference))
      .send({ building: 'block a', name: 'Roof', coordinates: OTHER_SPOT })
    expect((await shown(body.reference)).pins).toEqual([{ name: 'Block A', ...SPOT }])
  })

  it('sets no pin for a location outside a building', async () => {
    const { body } = await firstVisit()
    const added = await api
      .post(locationsOf(body.reference))
      .send({ name: 'Guardhouse', coordinates: SPOT })
    expect(added.body.coordinates).toEqual(SPOT)
    expect((await shown(body.reference)).pins).toEqual([])
  })

  it('changes them, keeps them when not sent, and clears them with null', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const { id } = (await api.post(path).send({ ...LOBBY, coordinates: SPOT })).body
    const moved = await api.patch(`${path}/${id}`).send({ ...LOBBY, coordinates: OTHER_SPOT })
    expect(moved.body.coordinates).toEqual(OTHER_SPOT)
    const renamed = await api.patch(`${path}/${id}`).send({ ...LOBBY, name: 'Entrance' })
    expect(renamed.body.coordinates).toEqual(OTHER_SPOT)
    const cleared = await api.patch(`${path}/${id}`).send({ ...LOBBY, coordinates: null })
    expect(cleared.body.coordinates).toBeUndefined()
  })

  it('sets a block pin from an edit when the block has none', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const { id } = (await api.post(path).send(LOBBY)).body
    await api.patch(`${path}/${id}`).send({ ...LOBBY, coordinates: SPOT })
    expect((await shown(body.reference)).pins).toEqual([{ name: 'Block A', ...SPOT }])
  })

  it('moves the block pin with changed coordinates, keeping its place in the list', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const { id } = (await api.post(path).send({ ...LOBBY, coordinates: SPOT })).body
    await api.post(path).send({ building: 'Block B', name: 'Roof', coordinates: SPOT })
    await api.patch(`${path}/${id}`).send({ ...LOBBY, coordinates: OTHER_SPOT })
    expect((await shown(body.reference)).pins).toEqual([
      { name: 'Block A', ...OTHER_SPOT },
      { name: 'Block B', ...SPOT },
    ])
  })

  it('pins a block a location moves to with the same coordinates', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const { id } = (await api.post(path).send({ ...LOBBY, coordinates: SPOT })).body
    await api.patch(`${path}/${id}`).send({ ...LOBBY, building: 'Block B', coordinates: SPOT })
    expect((await shown(body.reference)).pins).toEqual([
      { name: 'Block A', ...SPOT },
      { name: 'Block B', ...SPOT },
    ])
  })

  it('refuses coordinates on an archived assessment', async () => {
    const { body } = await firstVisit()
    await AssessmentModel.updateOne({ reference: body.reference }, { archivedAt: new Date() })
    const added = await api.post(locationsOf(body.reference)).send({ ...LOBBY, coordinates: SPOT })
    expect(added.status).toBe(409)
    expect((await shown(body.reference)).pins).toEqual([])
  })

  it('brings back no removed pin when a location with coordinates is renamed', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const { id } = (await api.post(path).send({ ...LOBBY, coordinates: SPOT })).body
    await api.put(`/api/sites/${body.site.id}/map`).send({ block: 'Block A', point: null })
    await api.patch(`${path}/${id}`).send({ ...LOBBY, name: 'Entrance', coordinates: SPOT })
    expect((await shown(body.reference)).pins).toEqual([])
  })

  it('refuses coordinates out of range, and from an unassigned engineer', async () => {
    const { body } = await firstVisit()
    const path = locationsOf(body.reference)
    const wrong = await api.post(path).send({ ...LOBBY, coordinates: { lat: 91, lng: 103 } })
    expect(wrong.status).toBe(400)
    const refused = await jideApi.post(path).send({ ...LOBBY, coordinates: SPOT })
    expect(refused.status).toBe(403)
    expect(refused.body.fields.coordinates).toMatch(/assigned/)
    expect((await shown(body.reference)).pins).toEqual([])
  })

  it('carries them to the next visit with the copied locations', async () => {
    const first = (await firstVisit()).body
    await api.post(locationsOf(first.reference)).send({ ...LOBBY, coordinates: SPOT })
    const site = (await AssessmentModel.findOne({ reference: first.reference }))!.site
    const next = await api
      .post('/api/assessments')
      .send(
        oneAssessment({ client: 'NUS', site: { id: String(site) }, siteVisitDate: '2026-03-10' }),
      )
    const reference = next.body.assessments[0].reference
    expect((await api.get(locationsOf(reference))).body[0].coordinates).toEqual(SPOT)
  })
})
