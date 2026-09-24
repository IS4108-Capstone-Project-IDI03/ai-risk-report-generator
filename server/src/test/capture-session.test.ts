import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

async function createAssessment(reference = 'RPT-2026-0411') {
  const site = await SiteModel.create({
    code: `SITE-${reference}`,
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

function startCapture(reference: string) {
  return request(app).post(`/api/assessments/${reference}/capture-session`)
}

describe('POST /api/assessments/:reference/capture-session', () => {
  it('starts a new active session when the assessment has none', async () => {
    const assessment = await createAssessment()

    const response = await startCapture(assessment.reference)

    expect(response.status).toBe(201)
    expect(response.body.session.status).toBe('active')
    const stored = await CaptureSessionModel.find({ assessment: assessment._id }).lean()
    expect(stored).toHaveLength(1)
    expect(String(stored[0]._id)).toBe(response.body.session.id)
  })

  it('returns the session in progress on reopen without starting another', async () => {
    const assessment = await createAssessment()
    const first = await startCapture(assessment.reference)

    const reopened = await startCapture(assessment.reference)

    expect(reopened.status).toBe(200)
    expect(reopened.body.session).toEqual(first.body.session)
    expect(await CaptureSessionModel.countDocuments({ assessment: assessment._id })).toBe(1)
  })

  it('starts exactly one session when capture opens on several devices at once', async () => {
    const assessment = await createAssessment()

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => startCapture(assessment.reference)),
    )

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201])
    expect(new Set(responses.map((r) => r.body.session.id)).size).toBe(1)
    expect(await CaptureSessionModel.countDocuments({ assessment: assessment._id })).toBe(1)
  })

  it('starts a new session once the previous one is no longer active', async () => {
    const assessment = await createAssessment()
    const first = await startCapture(assessment.reference)
    await CaptureSessionModel.updateOne(
      { _id: first.body.session.id },
      { status: 'ready_for_generation' },
    )

    const next = await startCapture(assessment.reference)

    expect(next.status).toBe(201)
    expect(next.body.session.id).not.toBe(first.body.session.id)
  })

  it('keeps each assessment to its own session', async () => {
    const tilbury = await createAssessment('RPT-2026-0411')
    const harlow = await createAssessment('RPT-2026-0412')

    const first = await startCapture(tilbury.reference)
    const second = await startCapture(harlow.reference)

    expect(second.status).toBe(201)
    expect(second.body.session.id).not.toBe(first.body.session.id)
  })

  it('identifies the assessment being captured', async () => {
    const assessment = await createAssessment()

    const response = await startCapture(assessment.reference)

    expect(response.body.assessment).toEqual({
      id: assessment.id,
      reference: 'RPT-2026-0411',
      client: 'Northgate Logistics',
      site: { code: 'SITE-RPT-2026-0411', name: 'Tilbury Distribution Centre' },
    })
  })

  it('returns 404 and starts nothing for an unknown assessment', async () => {
    await createAssessment('RPT-2026-0411')

    const response = await startCapture('RPT-2026-9999')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('Assessment RPT-2026-9999 was not found.')
    expect(await CaptureSessionModel.countDocuments()).toBe(0)
  })
})
