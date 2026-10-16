// Sections 4 and 5's inputs through the API (GN-03 AC1-AC3, AC5-AC7): the
// engineer's scores and values are saved against the report, and read back with
// the figures computed from them.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
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
const REFERENCE = 'RPT-2026-0314'
const rqr = `/api/assessments/${REFERENCE}/risk-quality`
const le = `/api/assessments/${REFERENCE}/loss-estimates`

async function assessment() {
  const site = await SiteModel.create({
    code: 'SITE-0314',
    name: 'Tower',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  return AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Client',
    surveyType: 'Survey',
    engineer: engineer._id,
  })
}

const SCORES = [
  ['External Exposure', 9, 10],
  ['Fire Protection', 8.1, 10],
  ['Occupancy Hazards', 8, 10],
  ['Construction', 9.3, 10],
  ['Water Supply', 8, 10],
  ['Surveillance', 8, 10],
  ['Management Programs', 8.3, 10],
].map(([category, current, potential]) => ({ category, current, potential }))

describe('Section 4 risk quality scores (GN-03)', () => {
  it('starts with the seven categories not entered, and no rating (AC1)', async () => {
    await assessment()
    const res = await api.get(rqr)

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(7)
    expect(res.body.categories[0]).toEqual({
      category: 'External Exposure',
      current: null,
      potential: null,
    })
    expect(res.body.result.current).toBeNull()
    expect(res.body.updatedAt).toBeNull()
  })

  it('saves the scores and returns the computed rating with its basis (AC2, AC3)', async () => {
    await assessment()
    const res = await api.put(rqr).send({ categories: SCORES })

    expect(res.status).toBe(200)
    expect(res.body.result.current).toEqual({ score: 83.9, rating: 'B', band: 'B: 70 to 84' })
    expect(res.body.result.basis.rulesVersion).toBe('rqr-provisional-equal-v1')
    expect((await api.get(rqr)).body.categories[1]).toEqual({
      category: 'Fire Protection',
      current: 8.1,
      potential: 10,
    })
  })

  it('refuses a score outside 0-10, a potential below the current one, or an unknown category', async () => {
    await assessment()
    const bad = (i: number, change: object) =>
      api.put(rqr).send({ categories: SCORES.map((s, j) => (i === j ? { ...s, ...change } : s)) })

    expect((await bad(0, { current: 11 })).status).toBe(400)
    expect((await bad(0, { current: 10, potential: 9 })).status).toBe(400)
    expect((await bad(0, { category: 'Weather' })).status).toBe(400)
  })

  it('can be changed only by the assigned engineer, and not once archived', async () => {
    const a = await assessment()
    const other = signedInAs(app, { ...engineer, _id: new Types.ObjectId(), staffId: 'TEST-2' })

    expect((await other.put(rqr).send({ categories: SCORES })).status).toBe(403)
    await AssessmentModel.updateOne({ _id: a._id }, { archivedAt: new Date() })
    expect((await api.put(rqr).send({ categories: SCORES })).status).toBe(409)
  })
})

describe('Section 5 loss estimates (GN-03)', () => {
  it("starts with the template's value rows, nothing entered and no estimate (AC1)", async () => {
    await assessment()
    const res = await api.get(le)

    expect(res.status).toBe(200)
    expect(res.body.inputs.pd.map((r: { item: string }) => r.item)).toEqual([
      'Buildings',
      'Contents',
      'Plant & Equipment',
      'Stock',
      'Other',
    ])
    expect(res.body.inputs.te.map((r: { item: string }) => r.item)).toEqual([
      'Business Interruption',
      'Loss of Rents',
      'Extra Expense',
      'Other',
    ])
    expect(res.body.inputs.currency).toBeNull()
    expect(res.body.result.levels.map((l: { total: null }) => l.total)).toEqual([null, null, null])
  })

  it('saves the values with currency, date and indemnity period, and computes each level (AC5-AC7)', async () => {
    await assessment()
    const inputs = {
      currency: 'SGD',
      dateOfValues: '2026-01-01',
      indemnityMonths: 12,
      pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
      te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
      levels: [
        {
          level: 'I',
          pd: [{ key: 'b', percent: 5 }],
          te: [{ key: 'bi', months: 1, percent: 100 }],
        },
      ],
    }
    const res = await api.put(le).send(inputs)

    expect(res.status).toBe(200)
    expect(res.body.inputs).toMatchObject({ currency: 'SGD', indemnityMonths: 12 })
    expect(res.body.result.levels[0]).toMatchObject({
      pdLoss: 50_000,
      teLoss: 10_000,
      total: 60_000,
    })
    expect(res.body.result.rulesVersion).toBe('le-v1')
    expect((await api.get(le)).body.inputs.dateOfValues).toBe('2026-01-01')

    const tooLong = {
      ...inputs,
      levels: [{ ...inputs.levels[0], te: [{ key: 'bi', months: 13, percent: 100 }] }],
    }
    expect((await api.put(le).send(tooLong)).status).toBe(400)
  })
})
