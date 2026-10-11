// Appendix A site photos (GN-07 AC5-AC12): which photos it shows, in what
// order, with what captions.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

useMemoryMongo()

const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
const REFERENCE = 'RPT-2026-0908'
const url = `/api/assessments/${REFERENCE}/appendix`
const ROOM = new Types.ObjectId()

async function assessment(details: Record<string, unknown> = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0908',
    name: 'Tower',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  const a = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Client',
    surveyType: 'Survey',
    engineer: engineer._id,
    locations: [{ _id: ROOM, name: 'Pump room', floor: 'B1', key: 'pump room|b1' }],
    ...details,
  })
  const session = await CaptureSessionModel.create({
    assessment: a._id,
    status: 'ready_for_generation',
  })
  return { a, session }
}

const photo = (name: string) => ({
  _id: new Types.ObjectId(),
  name,
  key: `photos/${name}`,
  contentType: 'image/jpeg' as const,
  size: 10,
})

async function observation(
  ids: { a: { _id: Types.ObjectId }; session: { _id: Types.ObjectId } },
  photos: ReturnType<typeof photo>[],
  extra: Record<string, unknown> = {},
) {
  return ObservationModel.create({
    assessment: ids.a._id,
    session: ids.session._id,
    engineer: engineer.name,
    note: 'Fire pump controller in auto.',
    recordings: [],
    photos,
    severity: 'low',
    location: ROOM,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Office',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
    ...extra,
  })
}

describe('Appendix A site photos (GN-07)', () => {
  it('lists every photo of the report with its details, and none selected at first', async () => {
    const ids = await assessment()
    const [pump, panel] = [photo('pump.jpg'), photo('panel.jpg')]
    const o = await observation(ids, [pump, panel])
    // AC5: a deleted observation's photos are not the report's.
    await observation(ids, [photo('gone.jpg')], {
      deleted: { at: new Date(), by: { id: String(engineer._id), name: engineer.name } },
    })

    const response = await api.get(url)

    expect(response.status).toBe(200)
    // AC9: nothing is shown until chosen.
    expect(response.body.selected).toEqual([])
    // AC5, AC10: each photo with its name, where, category and note.
    expect(response.body.available).toEqual([
      {
        photoId: String(pump._id),
        observationId: String(o._id),
        name: 'pump.jpg',
        url: `/api/observations/${o._id}/photos/${pump._id}/image`,
        location: 'Pump room, B1',
        category: 'Protection',
        note: 'Fire pump controller in auto.',
        selected: false,
      },
      expect.objectContaining({ name: 'panel.jpg', selected: false }),
    ])
  })

  it('saves the chosen photos in order with their captions, and deselects', async () => {
    const ids = await assessment()
    const [pump, panel] = [photo('pump.jpg'), photo('panel.jpg')]
    await observation(ids, [pump, panel])

    // AC6, AC12: chosen, and in the engineer's order, not capture order.
    const saved = await api.put(url).send({
      photos: [
        { photoId: String(panel._id), caption: 'Sprinkler panel' },
        { photoId: String(pump._id), caption: 'Fire pump' },
      ],
    })

    expect(saved.status).toBe(200)
    expect(
      saved.body.selected.map((p: { name: string; caption: string }) => [p.name, p.caption]),
    ).toEqual([
      ['panel.jpg', 'Sprinkler panel'],
      ['pump.jpg', 'Fire pump'],
    ])
    expect(saved.body.available.map((p: { selected: boolean }) => p.selected)).toEqual([true, true])

    // AC7: deselecting removes it from the appendix.
    const after = await api
      .put(url)
      .send({ photos: [{ photoId: String(pump._id), caption: 'Fire pump' }] })
    expect(after.body.selected.map((p: { name: string }) => p.name)).toEqual(['pump.jpg'])
    expect((await api.get(url)).body.selected).toEqual(after.body.selected)
  })

  it('drops a chosen photo once its observation is deleted', async () => {
    const ids = await assessment()
    const pump = photo('pump.jpg')
    const o = await observation(ids, [pump])
    await api.put(url).send({ photos: [{ photoId: String(pump._id), caption: 'Fire pump' }] })

    await ObservationModel.updateOne(
      { _id: o._id },
      { deleted: { at: new Date(), by: { id: String(engineer._id), name: engineer.name } } },
    )

    expect((await api.get(url)).body.selected).toEqual([])
  })

  it('refuses a photo that is not the report’s, or one given twice', async () => {
    const ids = await assessment()
    const pump = photo('pump.jpg')
    await observation(ids, [pump])
    const entry = { photoId: String(pump._id), caption: 'Fire pump' }

    expect(
      (await api.put(url).send({ photos: [{ ...entry, photoId: String(new Types.ObjectId()) }] }))
        .status,
    ).toBe(400)
    expect((await api.put(url).send({ photos: [entry, entry] })).status).toBe(400)
    expect(
      (await api.put(url).send({ photos: [{ ...entry, caption: 'x'.repeat(201) }] })).status,
    ).toBe(400)
  })

  it('can be changed only by the assigned engineer, and not once archived', async () => {
    const ids = await assessment()
    const pump = photo('pump.jpg')
    await observation(ids, [pump])
    const body = { photos: [{ photoId: String(pump._id), caption: 'Fire pump' }] }
    const other = signedInAs(app, { ...engineer, _id: new Types.ObjectId(), staffId: 'TEST-2' })

    expect((await other.put(url).send(body)).status).toBe(403)
    await AssessmentModel.updateOne({ _id: ids.a._id }, { archivedAt: new Date() })
    expect((await api.put(url).send(body)).status).toBe(409)
  })
})
