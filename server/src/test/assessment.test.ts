import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { Types } from 'mongoose'
import { UserModel } from '../models/user.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole, signedInAs } from './auth-test-helpers'

useMemoryMongo()

// A risk engineer is allowed everything below (F-05); role limits are in permissions.test.ts.
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
const other = {
  ...actor,
  _id: new Types.ObjectId(),
  staffId: 'TEST-2',
  name: 'Jide Okafor',
  email: 'jide@example.com',
}
const api = signedInAs(app, actor)
beforeEach(async () => {
  await UserModel.create([actor, other])
})

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
    engineerId: String(actor._id),
    ...overrides,
  }
}

function create(payload: unknown) {
  return api.post('/api/assessments').send(payload as object)
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
      engineer: { id: String(actor._id), name: 'Alex Rowe' },
      site: { code: 'SITE-0001', ...SITE },
    })
    const stored = await AssessmentModel.findOne({ reference: response.body.reference }).lean()
    expect(String(stored?._id)).toBe(response.body.id)
    expect(await SiteModel.countDocuments({ code: 'SITE-0001' })).toBe(1)
  })

  it('requires one engineer', async () => {
    for (const engineerId of [undefined, '', [String(actor._id)]]) {
      const rejected = await create(body({ engineerId }))
      expect(rejected.status).toBe(400)
      expect(rejected.body.fields.engineerId).toBe('Choose the engineer for this assessment.')
    }
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
      }),
    )

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      policyReference: null,
      siteVisitDate: null,
      reportDueDate: null,
      standards: [],
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

    const capture = await api.post(`/api/assessments/${created.body.reference}/capture-session`)

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
        engineer: actor._id,
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

    const response = await api.get('/api/assessments')

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
      engineer: actor._id,
      site: site._id,
      client: 'Client',
      surveyType: 'Property risk survey',
    })
    await CaptureSessionModel.create({ assessment: a._id, status: 'ready_for_generation' })
    await CaptureSessionModel.create({ assessment: a._id, status: 'active' })

    const response = await api.get('/api/assessments')

    expect(response.body[0].status).toBe('capturing')
  })
})

describe('Assignment identity (RV-10)', () => {
  it('scopes each engineer by ID despite duplicate or changed names', async () => {
    const first = await create(body({ engineerId: String(actor._id) }))
    const second = await create(body({ engineerId: String(other._id) }))
    const renamed = signedInAs(app, { ...actor, name: other.name })
    const otherApi = signedInAs(app, other)
    const refs = (items: { reference: string }[]) => items.map((a) => a.reference).sort()
    expect(refs((await renamed.get('/api/assessments')).body)).toEqual([first.body.reference])
    expect(refs((await otherApi.get('/api/assessments')).body)).toEqual([second.body.reference])
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get('/api/assessments')).body).toHaveLength(2)
    // The engineer's name is read from their account, so a rename shows.
    await UserModel.updateOne({ _id: other._id }, { $set: { name: 'Jidae Okafor' } })
    const [listed] = (await otherApi.get('/api/assessments')).body
    expect(listed.engineer).toEqual({ id: String(other._id), name: 'Jidae Okafor' })
  })

  it('lists only active risk engineers with minimal directory fields and rejects invalid assignments', async () => {
    await UserModel.updateOne({ _id: other._id }, { $set: { active: false } })
    const directory = await api.get('/api/assessments/engineers')
    expect(directory.body).toEqual([
      { id: String(actor._id), staffId: actor.staffId, name: actor.name, jobTitle: null },
    ])
    for (const id of [String(other._id), String(new Types.ObjectId()), 'A. Rowe']) {
      expect((await create(body({ engineerId: id }))).status).toBe(400)
    }
    expect(await AssessmentModel.countDocuments()).toBe(0)
  })
})

describe('Archiving (RV-10 AC8)', () => {
  it('lets the assigned engineer archive once, keeps it for admins and blocks capture', async () => {
    const { reference } = (await create(body())).body

    expect(
      (await signedInAs(app, other).post(`/api/assessments/${reference}/archive`)).status,
    ).toBe(403)
    expect((await api.post(`/api/assessments/${reference}/archive`)).status).toBe(204)
    expect((await api.post(`/api/assessments/${reference}/archive`)).status).toBe(409)
    expect((await api.post('/api/assessments/RPT-NONE/archive')).status).toBe(404)

    // Kept, not deleted: it still lists, with the archived status.
    const [mine] = (await api.get('/api/assessments')).body
    expect(mine).toMatchObject({ reference, status: 'archived' })
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get('/api/assessments')).body[0].status).toBe('archived')

    const capture = await api.post(`/api/assessments/${reference}/capture-session`)
    expect(capture.status).toBe(409)
    expect(await CaptureSessionModel.countDocuments()).toBe(0)
  })

  it('lets the assigned engineer restore it with the status it had (AC9)', async () => {
    const { reference } = (await create(body())).body
    await api.post(`/api/assessments/${reference}/capture-session`)
    expect((await api.post(`/api/assessments/${reference}/restore`)).status).toBe(409)
    await api.post(`/api/assessments/${reference}/archive`)

    expect(
      (await signedInAs(app, other).post(`/api/assessments/${reference}/restore`)).status,
    ).toBe(403)
    expect((await api.post(`/api/assessments/${reference}/restore`)).status).toBe(204)
    expect((await api.get('/api/assessments')).body[0]).toMatchObject({
      reference,
      status: 'capturing',
    })
    expect((await api.post(`/api/assessments/${reference}/capture-session`)).status).toBe(200)
  })
})

describe('Editing details (RV-10 AC10, AC11)', () => {
  const edit = (reference: string, changes: Record<string, unknown>, as = api) =>
    as.put(`/api/assessments/${reference}`).send({ ...body(), ...changes })

  it('lets the assigned engineer correct the details, keeping policy reference and standards', async () => {
    const { reference } = (await create(body())).body

    const saved = await edit(reference, {
      site: { ...SITE, name: 'Jurong Hub East', address: '' },
      client: 'Straits Freight',
      policyReference: 'POL-CHANGED',
      siteVisitDate: '',
      reportDueDate: '2026-10-30',
      standards: ['NFPA 13'],
    })
    expect(saved.status).toBe(204)

    const [listed] = (await api.get('/api/assessments')).body
    expect(listed).toMatchObject({
      reference,
      client: 'Straits Freight',
      // Not editable: an edit leaves the policy reference as it was created.
      policyReference: 'POL-00012345',
      siteVisitDate: null,
      reportDueDate: '2026-10-30',
      // Not editable: standards stay as chosen at creation.
      standards: ['FM Global 2-0', 'NFPA 13'],
      // The engineer stays the one the assessment was created for.
      engineer: { id: String(actor._id), name: 'Alex Rowe' },
      site: { name: 'Jurong Hub East', address: null },
    })
  })

  it('names each invalid field and changes nothing', async () => {
    const { reference } = (await create(body())).body

    const rejected = await edit(reference, { client: '', reportDueDate: '2026-10-01' })
    expect(rejected.status).toBe(400)
    expect(rejected.body.fields).toEqual({
      client: 'Client is required.',
      reportDueDate: 'The report due date must be on or after the site visit date.',
    })
    const [listed] = (await api.get('/api/assessments')).body
    expect(listed).toMatchObject({ client: 'Straits Logistics', reportDueDate: '2026-10-19' })
  })

  it('refuses anyone but the assigned engineer, and an archived assessment', async () => {
    const { reference } = (await create(body())).body

    expect((await edit(reference, { client: 'X' }, signedInAs(app, other))).status).toBe(403)
    expect((await edit('RPT-NONE', { client: 'X' })).status).toBe(404)
    await api.post(`/api/assessments/${reference}/archive`)
    expect((await edit(reference, { client: 'X' })).status).toBe(409)
    expect((await AssessmentModel.findOne({ reference }).lean())?.client).toBe('Straits Logistics')
  })
})
