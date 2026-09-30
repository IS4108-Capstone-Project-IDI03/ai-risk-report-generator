import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// A risk engineer is allowed everything below (F-05); role limits are in permissions.test.ts.
const api = signedInAsRole(app, 'risk_engineer')

async function assessment(reference = 'RPT-2026-0411') {
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
  })
}
const add = (body: object, reference = 'RPT-2026-0411') =>
  api.post(`/api/assessments/${reference}/locations`).send(body)

describe('/api/assessments/:reference/locations', () => {
  it('adds locations and lists them in the order they were added', async () => {
    await assessment()

    const stairwell = await add({ name: ' Stairwell B ', floor: 'Level 2' })
    const yard = await add({ name: 'External yard', floor: '' })

    expect(stairwell.status).toBe(201)
    expect(stairwell.body).toEqual({
      id: expect.any(String),
      name: 'Stairwell B',
      floor: 'Level 2',
    })
    expect(yard.body).toMatchObject({ name: 'External yard', floor: null })
    const list = await api.get('/api/assessments/RPT-2026-0411/locations')
    expect(list.status).toBe(200)
    expect(list.body.map((l: { name: string }) => l.name)).toEqual(['Stairwell B', 'External yard'])
  })

  it('refuses the same name on the same floor, whatever the case', async () => {
    await assessment()
    await add({ name: 'Stairwell B', floor: 'Level 2' })

    const again = await add({ name: 'stairwell b', floor: 'LEVEL 2' })
    const otherFloor = await add({ name: 'Stairwell B', floor: 'Level 3' })

    expect(again.status).toBe(409)
    expect(Object.keys(again.body.fields)).toEqual(['name'])
    expect(otherFloor.status).toBe(201)
    // Two taps at once still add it only once.
    const statuses = (await Promise.all([1, 2].map(() => add({ name: 'Lift A' })))).map(
      (r) => r.status,
    )
    expect(statuses.sort()).toEqual([201, 409])
  })

  it('names each invalid field and returns 404 for an unknown assessment', async () => {
    await assessment()

    for (const [body, field] of [
      [{ name: '  ' }, 'name'],
      [{ name: 'x'.repeat(101) }, 'name'],
      [{ name: 'Lift', floor: 'x'.repeat(41) }, 'floor'],
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
    const used = (await add({ name: 'Pump house' })).body
    await ObservationModel.create({
      assessment: a._id,
      session: a._id,
      engineer: 'A. Rowe',
      note: 'Pump test certificate missing.',
      severity: 'high',
      location: used.id,
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: 'Protection',
        effective_date: new Date(),
      },
    })
    const remove = (id: string, reference = 'RPT-2026-0411') =>
      api.delete(`/api/assessments/${reference}/locations/${id}`)

    expect((await remove(typo.id)).status).toBe(204)
    const inUse = await remove(used.id)
    expect(inUse.status).toBe(409)
    expect(inUse.body.error).toBe(
      "Pump house has 1 observation. It can't be removed while they are saved there.",
    )
    const list = await api.get('/api/assessments/RPT-2026-0411/locations')
    expect(list.body.map((l: { name: string }) => l.name)).toEqual(['Pump house'])
    expect((await remove(typo.id)).status).toBe(404)
    expect((await remove('nope')).status).toBe(404)
    expect((await remove(used.id, 'RPT-2026-9999')).status).toBe(404)
  })
})
