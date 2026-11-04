import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { Types } from 'mongoose'
import { UserModel } from '../models/user.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { SiteModel } from '../models/site.model'
import { ClientModel } from '../models/client.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole, signedInAs } from './auth-test-helpers'
import { oneAssessment } from './new-assessments'

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
    surveyType: 'First survey',
    siteVisitDate: '2026-10-05',
    reportDueDate: '2026-10-19',
    ...overrides,
  }
}

// Posts one assessment (CP-23's body) as the signed-in engineer.
function create(payload: Record<string, unknown>, as = api) {
  return as.post('/api/assessments').send(oneAssessment(payload))
}
// The one assessment a create made.
const made = async (payload: Record<string, unknown>, as = api) =>
  (await create(payload, as)).body.assessments[0]

// Another site of the same client: one client can't have two of one name (CP-17).
const ANOTHER_SITE = { site: { ...SITE, name: 'Jurong Hub East' } }

describe('POST /api/assessments', () => {
  it('creates the assessment and its site', async () => {
    const response = await create(body())

    expect(response.status).toBe(201)
    expect(response.body.assessments).toHaveLength(1)
    expect(response.body.assessments[0]).toMatchObject({
      reference: `RPT-${YEAR}-0001`,
      client: 'Straits Logistics',
      surveyType: 'First survey',
      siteVisitDate: '2026-10-05',
      siteVisitEndDate: null,
      reportDueDate: '2026-10-19',
      siteContacts: [],
      engineer: { id: String(actor._id), name: 'Alex Rowe' },
      site: { code: 'SITE-0001', ...SITE },
    })
    expect(response.body.clientId).toBe(response.body.assessments[0].clientId)
    const stored = await AssessmentModel.findOne({
      reference: response.body.assessments[0].reference,
    }).lean()
    expect(String(stored?._id)).toBe(response.body.assessments[0].id)
    expect(await SiteModel.countDocuments({ code: 'SITE-0001' })).toBe(1)
  })

  it("links the site to its client, one client whatever the name's case or spacing (CP-17 AC1)", async () => {
    await create(body())
    await create(body({ client: '  straits   LOGISTICS ', ...ANOTHER_SITE }))

    const clients = await ClientModel.find().lean()
    expect(clients).toMatchObject([{ name: 'Straits Logistics', key: 'straits logistics' }])
    const sites = await SiteModel.find().lean()
    expect(sites.map((s) => String(s.client))).toEqual([
      String(clients[0]._id),
      String(clients[0]._id),
    ])
  })

  it('assigns the signed-in engineer, whatever engineer the body names (CP-23 AC10)', async () => {
    const response = await api
      .post('/api/assessments')
      .send({ ...oneAssessment(body()), engineerId: String(other._id) })

    expect(response.status).toBe(201)
    expect(response.body.assessments[0].engineer).toEqual({
      id: String(actor._id),
      name: 'Alex Rowe',
    })
  })

  it("keeps a new client's division, the end date and the site contacts (CP-23 AC4)", async () => {
    const response = await create(
      body({
        division: 'Cold chain',
        siteVisitEndDate: '2026-10-06',
        siteContacts: [{ name: 'Mei Tan', role: 'Facilities manager' }, { name: 'Raj Kumar' }],
      }),
    )

    expect(response.status).toBe(201)
    expect(response.body.assessments[0]).toMatchObject({
      siteVisitEndDate: '2026-10-06',
      siteContacts: [
        { name: 'Mei Tan', role: 'Facilities manager' },
        { name: 'Raj Kumar', role: null },
      ],
    })
    expect((await ClientModel.findOne().lean())?.division).toBe('Cold chain')
  })

  it('creates several sites, each with several assessments, together (CP-23 AC15)', async () => {
    const response = await api.post('/api/assessments').send({
      client: { name: 'Straits Logistics' },
      sites: [
        {
          ref: 'site-1',
          ...SITE,
          assessments: [
            { ref: 'a-1', visitType: 'First survey', siteVisitDate: '2026-10-05' },
            { ref: 'a-2', visitType: 'Follow-up visit', siteVisitDate: '2026-12-01' },
          ],
        },
        {
          ref: 'site-2',
          ...SITE,
          name: 'Tuas Cold Store',
          assessments: [{ ref: 'a-3', visitType: 'First survey' }],
        },
      ],
    })

    expect(response.status).toBe(201)
    expect(
      response.body.assessments.map((a: { site: { name: string }; surveyType: string }) => [
        a.site.name,
        a.surveyType,
      ]),
    ).toEqual([
      [SITE.name, 'First survey'],
      [SITE.name, 'Follow-up visit'],
      ['Tuas Cold Store', 'First survey'],
    ])
    expect(await SiteModel.countDocuments()).toBe(2)
    expect(await ClientModel.countDocuments()).toBe(1)
  })

  it('numbers references in sequence', async () => {
    const first = await made(body())
    const second = await made(body(ANOTHER_SITE))

    expect([first.reference, second.reference]).toEqual([`RPT-${YEAR}-0001`, `RPT-${YEAR}-0002`])
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
    expect(response.body.assessments[0].reference).toBe(`RPT-${YEAR}-0002`)
  })

  it('gives concurrent creates distinct references', async () => {
    // Each its own site: one client can't have two of one name (CP-17 AC10).
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => create(body({ site: { ...SITE, name: `Hub ${i}` } }))),
    )

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    const created = responses.map((r) => r.body.assessments[0])
    expect(new Set(created.map((a) => a.reference)).size).toBe(5)
    expect(new Set(created.map((a) => a.site.code)).size).toBe(5)
  })

  it('accepts optional fields left empty', async () => {
    const response = await create(body({ siteVisitDate: '', reportDueDate: '' }))

    expect(response.status).toBe(201)
    expect(response.body.assessments[0]).toMatchObject({
      siteVisitDate: null,
      reportDueDate: null,
    })
  })

  it.each([
    [
      'the site name is blank',
      { site: { ...SITE, name: '  ' } },
      'sites.0.name',
      'Site name is required.',
    ],
    // A new site needs its address since CP-23.
    [
      'a new site has no address',
      { site: { ...SITE, address: '' } },
      'sites.0.address',
      'Site address is required.',
    ],
    ['the client is missing', { client: undefined }, 'client.name', 'Client is required.'],
    [
      'the jurisdiction is not a code',
      { site: { ...SITE, jurisdiction: 'Singapore' } },
      'sites.0.jurisdiction',
      'Jurisdiction must be a two-letter code, e.g. SG.',
    ],
    [
      'a date does not exist',
      { siteVisitDate: '2026-02-30' },
      'sites.0.assessments.0.siteVisitDate',
      'Site visit date must be a valid date (YYYY-MM-DD).',
    ],
    [
      'the report is due before the visit',
      { reportDueDate: '2026-10-01' },
      'sites.0.assessments.0.reportDueDate',
      'The report due date must be on or after the site visit date.',
    ],
    [
      'the visit ends before it starts',
      { siteVisitEndDate: '2026-10-04' },
      'sites.0.assessments.0.siteVisitEndDate',
      'The last survey day must be on or after the site visit date.',
    ],
    [
      'the visit type is not one of the three',
      { surveyType: 'Property risk survey' },
      'sites.0.assessments.0.visitType',
      'Choose a visit type: First survey, Resurvey or Follow-up visit.',
    ],
    // A site with no earlier assessment starts with a first survey (CP-23 AC17).
    [
      'a new site starts with a follow-up visit',
      { surveyType: 'Follow-up visit' },
      'sites.0.assessments.0.visitType',
      'A site with no earlier assessment starts with a First survey.',
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
      expect(await ClientModel.countDocuments()).toBe(0)
    },
  )

  it('accepts a last survey day and a report due date equal to the site visit date', async () => {
    const response = await create(
      body({
        siteVisitDate: '2026-10-05',
        siteVisitEndDate: '2026-10-05',
        reportDueDate: '2026-10-05',
      }),
    )
    expect(response.status).toBe(201)
  })

  it('refuses a request with no site, or a site with no assessment', async () => {
    const noSite = await api
      .post('/api/assessments')
      .send({ client: { name: 'Straits Logistics' }, sites: [] })
    expect(noSite.body.fields).toEqual({ sites: 'Add at least one site.' })

    const noVisit = await api.post('/api/assessments').send({
      client: { name: 'Straits Logistics' },
      sites: [{ ref: 's', ...SITE, assessments: [] }],
    })
    expect(noVisit.body.fields).toEqual({ 'sites.0.assessments': 'Add at least one assessment.' })
  })

  it('removes what it made when an assessment cannot be saved', async () => {
    const failure = vi
      .spyOn(AssessmentModel, 'create')
      .mockRejectedValueOnce(new Error('write failed'))

    const response = await create(body())

    failure.mockRestore()
    expect(response.status).toBe(500)
    expect(await SiteModel.countDocuments()).toBe(0)
    expect(await AssessmentModel.countDocuments()).toBe(0)
    // The client it added is removed too, so "Nothing created" is true.
    expect(await ClientModel.countDocuments()).toBe(0)
  })

  it('creates an assessment that capture can start on', async () => {
    const created = await made(body())

    const capture = await api.post(`/api/assessments/${created.reference}/capture-session`)

    expect(capture.status).toBe(201)
    expect(capture.body.assessment).toMatchObject({
      reference: created.reference,
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
    expect(response.body[3].captureStartedAt).toBeNull()
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
    const active = await CaptureSessionModel.create({ assessment: a._id, status: 'active' })

    const response = await api.get('/api/assessments')

    expect(response.body[0].status).toBe('capturing')
    // Its start, so the dashboard can continue the most recently started capture.
    expect(response.body[0].captureStartedAt).toBe(active.createdAt.toISOString())
  })
})

describe('Assignment identity (RV-10)', () => {
  it('scopes each engineer by ID despite duplicate or changed names', async () => {
    // Each assessment is assigned to the engineer who creates it (CP-23).
    const otherApi = signedInAs(app, other)
    const first = await made(body())
    const second = await made(body(ANOTHER_SITE), otherApi)
    const renamed = signedInAs(app, { ...actor, name: other.name })
    const refs = (items: { reference: string }[]) => items.map((a) => a.reference).sort()
    expect(refs((await renamed.get('/api/assessments')).body)).toEqual([first.reference])
    expect(refs((await otherApi.get('/api/assessments')).body)).toEqual([second.reference])
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get('/api/assessments')).body).toHaveLength(2)
    // The engineer's name is read from their account, so a rename shows.
    await UserModel.updateOne({ _id: other._id }, { $set: { name: 'Jidae Okafor' } })
    const [listed] = (await otherApi.get('/api/assessments')).body
    expect(listed.engineer).toEqual({ id: String(other._id), name: 'Jidae Okafor' })
  })
})

describe('Archiving (RV-10 AC8)', () => {
  it('lets the assigned engineer archive once, keeps it for admins and blocks capture', async () => {
    const { reference } = await made(body())

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
    const { reference } = await made(body())
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

  it('refuses a facility type off the list, but keeps an older site type unchanged (CP-30)', async () => {
    // The knowledge base's labels and the checklist's hazards use only the listed types.
    const refused = await create(body({ site: { ...SITE, facilityType: 'Warehouse' } }))
    expect(refused.status).toBe(400)
    expect(refused.body.fields['sites.0.facilityType']).toBe(
      'Choose a facility type from the list.',
    )

    const { site } = await made(body())
    // A site saved before the check, with a type now off the list. Its details
    // are corrected through /api/sites (CP-18).
    await SiteModel.updateOne({ _id: site.id }, { facilityType: 'Warehouse' })
    const unchanged = await api
      .put(`/api/sites/${site.id}`)
      .send({ ...SITE, facilityType: 'Warehouse', address: '3 Jurong Port Road' })
    expect(unchanged.status).toBe(204)
    const changed = await api.put(`/api/sites/${site.id}`).send({ ...SITE, facilityType: 'Depot' })
    expect(changed.status).toBe(400)
    expect(changed.body.fields.facilityType).toBe('Choose a facility type from the list.')
  })

  it('lets the assigned engineer correct its own details, keeping the engineer, client and site', async () => {
    const { reference, site } = await made(body())

    const saved = await edit(reference, {
      // The site and client change for all their assessments at once (CP-18),
      // not here: both are ignored.
      site: { ...SITE, name: 'Jurong Hub East', address: '' },
      client: 'Straits Freight',
      siteVisitDate: '',
      reportDueDate: '2026-10-30',
    })
    expect(saved.status).toBe(204)

    const [listed] = (await api.get('/api/assessments')).body
    expect(listed).toMatchObject({
      reference,
      client: 'Straits Logistics',
      siteVisitDate: null,
      reportDueDate: '2026-10-30',
      // The engineer stays the one the assessment was created for.
      engineer: { id: String(actor._id), name: 'Alex Rowe' },
      site: { id: site.id, name: SITE.name, address: SITE.address },
    })
    expect(await ClientModel.countDocuments()).toBe(1)
  })

  it('names each invalid field and changes nothing', async () => {
    const { reference } = await made(body())

    // Only the three visit types since CP-23; older values are still read.
    const rejected = await edit(reference, {
      surveyType: 'Property risk survey',
      reportDueDate: '2026-10-01',
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.fields).toEqual({
      surveyType: 'Choose a visit type: First survey, Resurvey or Follow-up visit.',
      reportDueDate: 'The report due date must be on or after the site visit date.',
    })
    const [listed] = (await api.get('/api/assessments')).body
    expect(listed).toMatchObject({
      surveyType: 'First survey',
      reportDueDate: '2026-10-19',
    })
  })

  it('keeps an older assessment type unchanged, but a changed type must be one of the three', async () => {
    const { reference } = await made(body())
    // Saved before CP-23's three types, and not yet migrated.
    await AssessmentModel.updateOne({ reference }, { surveyType: 'Property risk survey' })

    const unchanged = await edit(reference, {
      surveyType: 'Property risk survey',
      reportDueDate: '2026-10-30',
    })
    expect(unchanged.status).toBe(204)
    expect((await AssessmentModel.findOne({ reference }).lean())?.reportDueDate).toEqual(
      new Date('2026-10-30'),
    )

    const changed = await edit(reference, { surveyType: 'Natural hazard review' })
    expect(changed.status).toBe(400)
    expect(changed.body.fields).toEqual({
      surveyType: 'Choose a visit type: First survey, Resurvey or Follow-up visit.',
    })
  })

  it('refuses anyone but the assigned engineer, and an archived assessment', async () => {
    const { reference } = await made(body())
    const change = { surveyType: 'Resurvey' }

    expect((await edit(reference, change, signedInAs(app, other))).status).toBe(403)
    expect((await edit('RPT-NONE', change)).status).toBe(404)
    await api.post(`/api/assessments/${reference}/archive`)
    expect((await edit(reference, change)).status).toBe(409)
    expect((await AssessmentModel.findOne({ reference }).lean())?.surveyType).toBe('First survey')
  })
})
