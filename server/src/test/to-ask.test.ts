import { Types } from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type ObservationKind } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CP-35 hand-off: GET /api/assessments/:reference/to-ask lists the info requests of an assessment's
// split notes, so the engineer sees what to ask the client. Read only; nothing is saved.
useMemoryMongo()

const alex = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, alex)
const BAY = new Types.ObjectId()
const URL = '/api/assessments/RPT-1/to-ask'

async function setup() {
  const site = await SiteModel.create({
    code: 'S-1',
    name: 'Tilbury DC',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const a = await AssessmentModel.create({
    reference: 'RPT-1',
    site: site._id,
    client: 'Northgate',
    surveyType: 'Property risk survey',
    engineer: alex._id,
    locations: [{ _id: BAY, name: 'Fire pump room', floor: 'Basement 1', key: 'fpr|b1' }],
  })
  const session = await CaptureSessionModel.create({
    assessment: a._id,
    status: 'ready_for_generation',
  })
  return { assessment: a._id, session: session._id }
}
const obs = (
  ids: { assessment: Types.ObjectId; session: Types.ObjectId },
  kinds: ObservationKind[] | undefined,
  note = 'a note',
  extra = {},
) =>
  ObservationModel.create({
    ...ids,
    engineer: alex.name,
    note,
    recordings: [],
    severity: 'high',
    location: BAY,
    ...(kinds && { kinds }),
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
    ...extra,
  })

describe('GET /api/assessments/:reference/to-ask (CP-36)', () => {
  it('lists the observations tagged Information request, each with its place and severity', async () => {
    const ids = await setup()
    const a = await obs(ids, ['info_request'], 'Ask for the valve schedule.')
    await obs(ids, ['fact', 'info_request'], 'Valve shut; ask who tests the pump.', {
      severity: 'critical',
    })
    await obs(ids, ['recommendation'], 'Lock it open.')
    await obs(ids, undefined, 'Only a fact.')

    const res = await api.get(URL)

    expect(res.status).toBe(200)
    expect(res.body.items.map((i: { text: string }) => i.text)).toEqual([
      'Ask for the valve schedule.',
      'Valve shut; ask who tests the pump.',
    ])
    expect(res.body.items[0]).toMatchObject({
      observationId: String(a._id),
      location: 'Fire pump room, Basement 1',
      severity: 'high',
    })
    expect(res.body.items[1].severity).toBe('critical')
  })

  it('says which requests are asked, and ticking one does not change the others', async () => {
    const ids = await setup()
    const a = await obs(ids, ['info_request'], 'Ask for the valve schedule.')
    await obs(ids, ['info_request'], 'Ask who tests the pump.')
    expect((await api.patch(`/api/observations/${a._id}`).send({ asked: true })).status).toBe(200)
    const items = (await api.get(URL)).body.items
    expect(
      items.find((i: { observationId: string }) => i.observationId === String(a._id)).asked,
    ).toBe(true)
    expect(items.filter((i: { asked: boolean }) => i.asked)).toHaveLength(1)
  })

  it('is empty when none is tagged, and skips a deleted observation', async () => {
    const ids = await setup()
    expect((await api.get(URL)).body.items).toEqual([])
    await obs(ids, ['info_request'], 'Ask about the roof.', {
      deleted: { at: new Date(), by: { id: String(alex._id), name: alex.name } },
    })
    await obs(ids, undefined)
    expect((await api.get(URL)).body.items).toEqual([])
  })

  it('answers 404 for an unknown assessment and 401 without a session', async () => {
    await setup()
    expect((await api.get('/api/assessments/NOPE/to-ask')).status).toBe(404)
    expect((await request(app).get(URL)).status).toBe(401)
  })
})
