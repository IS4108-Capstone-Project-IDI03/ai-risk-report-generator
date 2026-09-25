import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const YEAR = new Date().getUTCFullYear()
const SITE = {
  name: 'Jurong Distribution Hub',
  address: '2 Jurong Port Road',
  jurisdiction: 'SG',
  facilityType: 'Distribution warehouse',
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    site: SITE,
    client: 'Straits Logistics',
    policyReference: 'POL-00012345',
    surveyType: 'Property risk survey',
    siteVisitDate: '2026-10-05',
    reportDueDate: '2026-10-19',
    standards: ['FM Global 2-0', 'NFPA 13'],
    engineers: ['A. Rowe', 'J. Okafor'],
    ...overrides,
  }
}

function create(payload: unknown) {
  return request(app)
    .post('/api/assessments')
    .send(payload as object)
}

describe('POST /api/assessments', () => {
  it('creates the assessment and its site', async () => {
    const response = await create(body())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      reference: `RPT-${YEAR}-0001`,
      client: 'Straits Logistics',
      policyReference: 'POL-00012345',
      surveyType: 'Property risk survey',
      siteVisitDate: '2026-10-05',
      reportDueDate: '2026-10-19',
      standards: ['FM Global 2-0', 'NFPA 13'],
      engineers: ['A. Rowe', 'J. Okafor'],
      site: { code: 'SITE-0001', ...SITE },
    })
    const stored = await AssessmentModel.findOne({ reference: response.body.reference }).lean()
    expect(String(stored?._id)).toBe(response.body.id)
    expect(await SiteModel.countDocuments({ code: 'SITE-0001' })).toBe(1)
  })

  it('numbers references in sequence', async () => {
    const first = await create(body())
    const second = await create(body())

    expect([first.body.reference, second.body.reference]).toEqual([
      `RPT-${YEAR}-0001`,
      `RPT-${YEAR}-0002`,
    ])
  })

  it('skips a reference that is already taken', async () => {
    const seeded = await SiteModel.create({ code: 'SYN-SG-001', ...SITE })
    await AssessmentModel.create({
      reference: `RPT-${YEAR}-0001`,
      site: seeded._id,
      client: 'Seeded client',
      surveyType: 'Property risk survey',
    })

    const response = await create(body())

    expect(response.status).toBe(201)
    expect(response.body.reference).toBe(`RPT-${YEAR}-0002`)
  })

  it('gives concurrent creates distinct references', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => create(body())))

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    expect(new Set(responses.map((r) => r.body.reference)).size).toBe(5)
    expect(new Set(responses.map((r) => r.body.site.code)).size).toBe(5)
  })

  it('accepts optional fields left empty', async () => {
    const response = await create(
      body({
        site: { ...SITE, address: '' },
        policyReference: '',
        siteVisitDate: '',
        reportDueDate: '',
        standards: [],
        engineers: [],
      }),
    )

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      policyReference: null,
      siteVisitDate: null,
      reportDueDate: null,
      standards: [],
      engineers: [],
      site: { address: null },
    })
  })

  it.each([
    [
      'the site name is blank',
      { site: { ...SITE, name: '  ' } },
      'site.name',
      'Site name is required.',
    ],
    ['the client is missing', { client: undefined }, 'client', 'Client is required.'],
    [
      'the jurisdiction is not a code',
      { site: { ...SITE, jurisdiction: 'Singapore' } },
      'site.jurisdiction',
      'Jurisdiction must be a two-letter code, e.g. SG.',
    ],
    [
      'a date does not exist',
      { siteVisitDate: '2026-02-30' },
      'siteVisitDate',
      'Site visit date must be a valid date (YYYY-MM-DD).',
    ],
    [
      'the report is due before the visit',
      { reportDueDate: '2026-10-01' },
      'reportDueDate',
      'The report due date must be on or after the site visit date.',
    ],
  ])(
    'rejects the request when %s, and stores nothing',
    async (_case, overrides, field, message) => {
      const response = await create(body(overrides))

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('The assessment details are invalid.')
      expect(response.body.fields[field]).toBe(message)
      expect(await AssessmentModel.countDocuments()).toBe(0)
      expect(await SiteModel.countDocuments()).toBe(0)
    },
  )

  it('removes the new site when the assessment cannot be saved', async () => {
    const failure = vi
      .spyOn(AssessmentModel, 'create')
      .mockRejectedValueOnce(new Error('write failed'))

    const response = await create(body())

    failure.mockRestore()
    expect(response.status).toBe(500)
    expect(await SiteModel.countDocuments()).toBe(0)
  })

  it('creates an assessment that capture can start on', async () => {
    const created = await create(body())

    const capture = await request(app).post(
      `/api/assessments/${created.body.reference}/capture-session`,
    )

    expect(capture.status).toBe(201)
    expect(capture.body.assessment).toMatchObject({
      reference: created.body.reference,
      client: 'Straits Logistics',
      site: { name: 'Jurong Distribution Hub' },
    })
  })
})

describe('GET /api/assessments', () => {
  it('lists assessments with their site, date and status, latest visit first', async () => {
    const site = await SiteModel.create({ code: 'SITE-0001', ...SITE })
    const seed = (reference: string, siteVisitDate: string, extra = {}) =>
      AssessmentModel.create({
        reference,
        site: site._id,
        client: `Client ${reference}`,
        surveyType: 'Property risk survey',
        siteVisitDate: new Date(siteVisitDate),
        engineers: ['A. Rowe'],
        ...extra,
      })
    await seed('RPT-A', '2026-01-01')
    const capturing = await seed('RPT-B', '2026-02-01')
    const ready = await seed('RPT-C', '2026-03-01')
    const drafted = await seed('RPT-D', '2026-04-01', { reportStatus: 'draft' })
    await CaptureSessionModel.create({ assessment: capturing._id })
    await CaptureSessionModel.create({ assessment: ready._id, status: 'ready_for_generation' })
    // A stored report status wins over the capture session.
    await CaptureSessionModel.create({ assessment: drafted._id, status: 'ready_for_generation' })

    const response = await request(app).get('/api/assessments')

    expect(response.status).toBe(200)
    expect(
      response.body.map((a: { reference: string; status: string; siteVisitDate: string }) => [
        a.reference,
        a.status,
        a.siteVisitDate,
      ]),
    ).toEqual([
      ['RPT-D', 'draft', '2026-04-01'],
      ['RPT-C', 'ready_to_generate', '2026-03-01'],
      ['RPT-B', 'capturing', '2026-02-01'],
      ['RPT-A', 'not_started', '2026-01-01'],
    ])
    expect(response.body[0].site).toMatchObject({ code: 'SITE-0001', name: SITE.name })
  })

  it('uses the latest capture session', async () => {
    const site = await SiteModel.create({ code: 'SITE-0001', ...SITE })
    const a = await AssessmentModel.create({
      reference: 'RPT-A',
      site: site._id,
      client: 'Client',
      surveyType: 'Property risk survey',
    })
    await CaptureSessionModel.create({ assessment: a._id, status: 'ready_for_generation' })
    await CaptureSessionModel.create({ assessment: a._id, status: 'active' })

    const response = await request(app).get('/api/assessments')

    expect(response.body[0].status).toBe('capturing')
  })
})
