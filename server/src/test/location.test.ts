import { describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// A risk engineer is allowed everything below (F-05); role limits are in
// permissions.test.ts. They are the assessment's assigned engineer.
const actor = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, actor)

async function assessment(reference = 'RPT-2026-0411', details: object = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  return AssessmentModel.create({
    reference,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    engineer: actor._id,
    ...details,
  })
}
const add = (body: object, reference = 'RPT-2026-0411') =>
  api.post(`/api/assessments/${reference}/locations`).send(body)
const edit = (id: string, body: object, as = api, reference = 'RPT-2026-0411') =>
  as.patch(`/api/assessments/${reference}/locations/${id}`).send(body)
const list = async () =>
  (await api.get('/api/assessments/RPT-2026-0411/locations')).body as {
    building: string | null
    floor: string | null
    name: string
  }[]
const observationAt = (assessmentId: Types.ObjectId, location: string) =>
  ObservationModel.create({
    assessment: assessmentId,
    session: assessmentId,
    engineer: 'A. Rowe',
    note: 'Pump test certificate missing.',
    severity: 'high',
    location,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })

describe('/api/assessments/:reference/locations', () => {
  it('adds locations and lists them in the order they were added', async () => {
    await assessment()

    const staircase = await add({ building: ' Block A ', floor: 'Level 2', name: ' Staircase ' })
    const facade = await add({ building: 'Block A', name: 'Facade' })
    const route = await add({ name: 'Fire access route', floor: '', building: '' })

    expect(staircase.status).toBe(201)
    expect(staircase.body).toEqual({
      id: expect.any(String),
      building: 'Block A',
      floor: 'Level 2',
      name: 'Staircase',
    })
    // A whole-building location has no level (CP-16).
    expect(facade.body).toMatchObject({ building: 'Block A', floor: null, name: 'Facade' })
    // Elsewhere on site: a name only.
    expect(route.body).toMatchObject({ building: null, floor: null, name: 'Fire access route' })
    const response = await api.get('/api/assessments/RPT-2026-0411/locations')
    expect(response.status).toBe(200)
    expect(response.body.map((l: { name: string }) => l.name)).toEqual([
      'Staircase',
      'Facade',
      'Fire access route',
    ])
  })

  it('refuses the same name, level and building, whatever the case', async () => {
    await assessment()
    await add({ building: 'Block A', floor: 'Level 2', name: 'Staircase' })

    const again = await add({ building: 'BLOCK A', floor: 'level 2', name: 'staircase' })
    const otherLevel = await add({ building: 'Block A', floor: 'Level 3', name: 'Staircase' })
    const otherBuilding = await add({ building: 'Block B', floor: 'Level 2', name: 'Staircase' })

    expect(again.status).toBe(409)
    expect(Object.keys(again.body.fields)).toEqual(['name'])
    expect(otherLevel.status).toBe(201)
    expect(otherBuilding.status).toBe(201)
    // Two taps at once still add it only once.
    const statuses = (await Promise.all([1, 2].map(() => add({ name: 'Lift A' })))).map(
      (r) => r.status,
    )
    expect(statuses.sort()).toEqual([201, 409])
  })

  it('keeps a building and level as already listed, whatever the case', async () => {
    await assessment()
    await add({ building: 'Block A', floor: 'Level 2', name: 'Staircase' })

    const lobby = await add({ building: 'block a', floor: 'LEVEL 2', name: 'Lobby' })

    expect(lobby.body).toMatchObject({ building: 'Block A', floor: 'Level 2', name: 'Lobby' })
  })

  it('saves a level it knows in its standard spelling, and any other as given', async () => {
    await assessment()

    const levels = []
    for (const [floor, name] of [
      ['L2', 'Staircase'],
      ['lvl 2', 'Lobby'],
      ['2nd floor', 'Store room'],
      ['b1', 'Pump room'],
      ['GF', 'Entrance'],
      ['rooftop', 'Plant'],
      ['Podium', 'Garden'],
    ])
      levels.push((await add({ building: 'Block A', floor, name })).body.floor)

    expect(levels).toEqual([
      'Level 2',
      'Level 2',
      'Level 2',
      'Basement 1',
      'Ground',
      'Roof',
      'Podium',
    ])
    // "L2" and "Level 2" are one level, so this is already listed.
    expect((await add({ building: 'Block A', floor: 'Level 2', name: 'Staircase' })).status).toBe(
      409,
    )
  })

  it('keeps finding locations saved before buildings, with a floor and no building', async () => {
    await assessment('RPT-2026-0411', {
      locations: [{ name: 'Stairwell B', floor: 'Level 2', key: 'stairwell b|level 2' }],
    })

    expect(await list()).toEqual([
      { id: expect.any(String), building: null, floor: 'Level 2', name: 'Stairwell B' },
    ])
    // It now has a building, so it is another place.
    expect((await add({ building: 'Block A', floor: 'Level 2', name: 'Stairwell B' })).status).toBe(
      201,
    )
  })

  it('names each invalid field and returns 404 for an unknown assessment', async () => {
    await assessment()

    for (const [body, field] of [
      [{ name: '  ' }, 'name'],
      [{ name: 'x'.repeat(101) }, 'name'],
      [{ building: 'x'.repeat(101), name: 'Lift' }, 'building'],
      [{ building: 'Block A', name: 'Lift', floor: 'x'.repeat(41) }, 'floor'],
      // Only a location in a building has a level.
      [{ name: 'Lift', floor: 'Level 2' }, 'floor'],
    ] as const) {
      const response = await add(body)
      expect(response.status).toBe(400)
      expect(Object.keys(response.body.fields)).toEqual([field])
    }
    expect((await add({ name: 'Lift' }, 'RPT-2026-9999')).status).toBe(404)
    expect((await api.get('/api/assessments/RPT-2026-9999/locations')).status).toBe(404)
  })

  it('removes a location with no observations, and keeps one that has some', async () => {
    const a = await assessment()
    const typo = (await add({ name: 'Stairwel B' })).body
    const used = (await add({ building: 'Block A', floor: 'B1', name: 'Pump room' })).body
    await observationAt(a._id, used.id)
    const remove = (id: string, reference = 'RPT-2026-0411') =>
      api.delete(`/api/assessments/${reference}/locations/${id}`)

    expect((await remove(typo.id)).status).toBe(204)
    const inUse = await remove(used.id)
    expect(inUse.status).toBe(409)
    expect(inUse.body.error).toBe(
      "Pump room, Basement 1, Block A has 1 observation. It can't be removed while they are saved there.",
    )
    expect((await list()).map((l) => l.name)).toEqual(['Pump room'])
    expect((await remove(typo.id)).status).toBe(404)
    expect((await remove('nope')).status).toBe(404)
    expect((await remove(used.id, 'RPT-2026-9999')).status).toBe(404)
  })
})

describe('PATCH /api/assessments/:reference/locations/:id (CP-16)', () => {
  it('changes a location in place, and its observations follow it', async () => {
    const a = await assessment()
    const typo = (await add({ building: 'Block A', floor: 'Level 2', name: 'Stiarcase' })).body
    await observationAt(a._id, typo.id)

    const response = await edit(typo.id, {
      building: 'Block A',
      floor: 'Level 2',
      name: 'Staircase',
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      id: typo.id,
      building: 'Block A',
      floor: 'Level 2',
      name: 'Staircase',
    })
    const observations = await api.get('/api/assessments/RPT-2026-0411/observations')
    expect(observations.body[0].location).toEqual(response.body)
  })

  it('moves a location saved before buildings into one, or out of one', async () => {
    await assessment('RPT-2026-0411', {
      locations: [{ name: 'Lobby', floor: 'Level 1', key: 'lobby|level 1' }],
    })
    const [old] = (await api.get('/api/assessments/RPT-2026-0411/locations')).body

    const moved = await edit(old.id, { building: 'Block A', floor: 'Level 1', name: 'Lobby' })
    const outside = await edit(old.id, { name: 'Guardhouse' })

    expect(moved.body).toMatchObject({ building: 'Block A', floor: 'Level 1', name: 'Lobby' })
    expect(outside.body).toEqual({ id: old.id, building: null, floor: null, name: 'Guardhouse' })
    // The key moved with it, so the old details are free again.
    expect((await add({ building: 'Block A', floor: 'Level 1', name: 'Lobby' })).status).toBe(201)
  })

  it('refuses details another location has, but allows a change of case', async () => {
    await assessment()
    await add({ building: 'Block A', floor: 'Level 2', name: 'Staircase' })
    const lobby = (await add({ building: 'Block A', floor: 'Level 2', name: 'lobby' })).body

    const clash = await edit(lobby.id, { building: 'block a', floor: 'Level 2', name: 'STAIRCASE' })
    const cased = await edit(lobby.id, { building: 'Block A', floor: 'Level 2', name: 'Lobby' })

    expect(clash.status).toBe(409)
    expect(Object.keys(clash.body.fields)).toEqual(['name'])
    expect(cased.status).toBe(200)
    expect((await list()).map((l) => l.name)).toEqual(['Staircase', 'Lobby'])
  })

  it('lets only the assigned engineer change it, and not once archived', async () => {
    await assessment()
    const lobby = (await add({ building: 'Block A', floor: 'Level 1', name: 'Lobby' })).body
    const change = { building: 'Block A', floor: 'Level 1', name: 'Main lobby' }

    const other = await edit(lobby.id, change, signedInAsRole(app, 'risk_engineer'))
    const admin = await edit(lobby.id, change, signedInAsRole(app, 'knowledge_admin'))
    await AssessmentModel.updateOne({}, { archivedAt: new Date() })
    const archived = await edit(lobby.id, change)

    expect(other.status).toBe(403)
    expect(other.body.error).toBe(
      'Only the engineer assigned to this assessment can change its locations.',
    )
    expect(admin.status).toBe(403)
    expect(archived.status).toBe(409)
    expect((await list()).map((l) => l.name)).toEqual(['Lobby'])
  })

  it('names each invalid field, and returns 404 for an unknown location', async () => {
    await assessment()
    const lobby = (await add({ building: 'Block A', floor: 'Level 1', name: 'Lobby' })).body

    const invalid = await edit(lobby.id, { name: 'Lobby', floor: 'Level 1' })

    expect(invalid.status).toBe(400)
    expect(invalid.body.fields).toEqual({ floor: 'Only a location in a building has a level.' })
    expect((await edit(new Types.ObjectId().toString(), { name: 'Lobby' })).status).toBe(404)
    expect((await edit('nope', { name: 'Lobby' })).status).toBe(404)
    expect((await edit(lobby.id, { name: 'Lobby' }, api, 'RPT-2026-9999')).status).toBe(404)
  })
})
