// F-12: three gaps around the practice assessment (ADR 0003). Its records are reachable by id
// only for the owner (observation, client, site and client document routes answer 404 to
// anyone else, an admin included); no real assessment can be created under its client or
// site; and an insights summary written on its client is costed as `walkthrough`.
// Calls the routes through supertest on an in-memory Mongo; rag-service is a stubbed fetch.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientModel } from '../models/client.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { oneAssessment } from './new-assessments'

useMemoryMongo()

const account = (name: string, staffId: string, role: 'risk_engineer' | 'knowledge_admin') => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId.toLowerCase()}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = account('Alex Rowe', 'TEST-1', 'risk_engineer') // owns the practice assessment
const jide = account('Jide Okafor', 'TEST-2', 'risk_engineer')
const sana = account('Sana Patel', 'TEST-3', 'knowledge_admin')
const VIEWERS = { owner: alex, other: jide, admin: sana }
type Viewer = keyof typeof VIEWERS
const as = (who: Viewer) => signedInAs(app, VIEWERS[who])

const metadata = {
  source_type: 'observation' as const,
  jurisdiction: 'SG',
  facility_type: 'Warehouse',
  COPE_dimension: ['Protection' as const],
  effective_date: new Date(),
}
const observe = (assessment: Types.ObjectId, engineer: string) =>
  ObservationModel.create({
    assessment,
    session: new Types.ObjectId(),
    engineer,
    note: 'Sprinkler valve found shut.',
    recordings: [],
    severity: 'high',
    location: new Types.ObjectId(),
    metadata,
  })
const document = (client: Types.ObjectId) =>
  ClientDocumentModel.collection.insertOne({
    client,
    placement: { kind: 'client' },
    name: 'Request.pdf',
    contentType: 'application/pdf',
    size: 10,
    sha256: 'x',
    key: 'k',
    origin: 'upload',
    uploaded: { at: new Date(), by: { id: String(alex._id), name: alex.name } },
  })

// A real client with a real assessment for each engineer, and Alex's live practice assessment
// on its own made-up client and site, each with an observation and a client document.
const ids = {} as Record<
  | 'client'
  | 'site'
  | 'observation'
  | 'document'
  | 'practiceClient'
  | 'practiceSite'
  | 'practiceObservation'
  | 'practiceDocument',
  string
>
let practiceAssessment: Types.ObjectId
beforeEach(async () => {
  await UserModel.create([alex, jide, sana])
  const client = await ClientModel.create({ name: 'Northgate', key: 'northgate' })
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tuas',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
    client: client._id,
  })
  const visit = (reference: string, engineer: Types.ObjectId) =>
    AssessmentModel.create({
      reference,
      site: site._id,
      surveyType: 'First survey',
      engineer,
      siteVisitDate: new Date(),
      reportDueDate: new Date(),
    })
  const real = await visit('RPT-2026-0001', alex._id)
  await visit('RPT-2026-0002', jide._id)
  const practiceClient = await ClientModel.create({
    name: 'Harbourline (practice)',
    key: `practice:${alex._id}:PRACTICE-0001`,
    practice: true,
  })
  const practiceSite = await SiteModel.create({
    code: 'PRACTICE-0001',
    name: 'Harbourline Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
    client: practiceClient._id,
    practice: true,
  })
  const practice = await AssessmentModel.create({
    reference: 'PRACTICE-0001',
    site: practiceSite._id,
    surveyType: 'First survey',
    engineer: alex._id,
    siteVisitDate: new Date(),
    reportDueDate: new Date(),
    practice: 'live',
  })
  practiceAssessment = practice._id
  const [obs, practiceObs] = [
    await observe(real._id, alex.name),
    await observe(practice._id, alex.name),
  ]
  const [doc, practiceDoc] = [await document(client._id), await document(practiceClient._id)]
  Object.assign(ids, {
    client: String(client._id),
    site: String(site._id),
    observation: String(obs._id),
    document: String(doc.insertedId),
    practiceClient: String(practiceClient._id),
    practiceSite: String(practiceSite._id),
    practiceObservation: String(practiceObs._id),
    practiceDocument: String(practiceDoc.insertedId),
  })
})

const VIEWER_NAMES = ['other', 'admin'] as const

describe('a practice observation is reachable by id only for its owner (F-12)', () => {
  it('opens for the owner', async () => {
    expect((await as('owner').get(`/api/observations/${ids.practiceObservation}`)).status).toBe(200)
  })

  it.each(VIEWER_NAMES)('answers 404 to %s, on read and on change', async (who) => {
    const path = `/api/observations/${ids.practiceObservation}`
    expect((await as(who).get(path)).status).toBe(404)
    expect((await as(who).patch(path).send({ note: 'Changed.' })).status).toBe(404)
    expect((await as(who).delete(path)).status).toBe(404)
    expect((await as(who).post(`${path}/restore`)).status).toBe(404)
    expect((await as(who).get(`${path}/photos/p1/image`)).status).toBe(404)
    expect((await ObservationModel.findById(ids.practiceObservation).lean())?.note).toBe(
      'Sprinkler valve found shut.',
    )
  })

  it('answers 404 to everyone, the owner included, once the practice assessment is hidden', async () => {
    await AssessmentModel.updateOne({ _id: practiceAssessment }, { practice: 'hidden' })
    expect((await as('owner').get(`/api/observations/${ids.practiceObservation}`)).status).toBe(404)
  })

  it('leaves a real observation as it was', async () => {
    const path = `/api/observations/${ids.observation}`
    expect((await as('owner').get(path)).status).toBe(200)
    expect((await as('admin').get(path)).status).toBe(200)
    expect((await as('other').get(path)).status).toBe(403)
  })
})

describe("a practice client's page, documents and site are reachable by id only for its owner (F-12)", () => {
  const clientPaths = (id: string) => [
    `/api/clients/${id}`,
    `/api/clients/${id}/sites`,
    `/api/clients/${id}/documents`,
    `/api/clients/${id}/document-tags`,
    `/api/clients/${id}/insights`,
  ]

  it('opens for the owner', async () => {
    for (const path of clientPaths(ids.practiceClient))
      expect((await as('owner').get(path)).status, path).toBe(200)
  })

  it.each(VIEWER_NAMES)('answers 404 to %s on every client route', async (who) => {
    for (const path of clientPaths(ids.practiceClient))
      expect((await as(who).get(path)).status, path).toBe(404)
    const base = `/api/clients/${ids.practiceClient}`
    expect((await as(who).put(base).send({ name: 'Renamed' })).status).toBe(404)
    expect((await as(who).post(`${base}/remove`)).status).toBe(404)
    expect((await as(who).post(`${base}/restore`)).status).toBe(404)
    expect((await as(who).post(`${base}/insights/summary`)).status).toBe(404)
    expect((await ClientModel.findById(ids.practiceClient).lean())?.name).toBe(
      'Harbourline (practice)',
    )
  })

  it.each(VIEWER_NAMES)('answers 404 to %s on the site and a document, by id', async (who) => {
    const site = `/api/sites/${ids.practiceSite}`
    expect((await as(who).put(site).send({ name: 'Renamed' })).status).toBe(404)
    expect((await as(who).put(`${site}/map`).send({})).status).toBe(404)
    expect((await as(who).post(`${site}/remove`)).status).toBe(404)
    expect((await as(who).post(`${site}/restore`)).status).toBe(404)
    const doc = `/api/client-documents/${ids.practiceDocument}`
    expect((await as(who).get(`${doc}/file`)).status).toBe(404)
    expect((await as(who).delete(doc)).status).toBe(404)
    expect(await ClientDocumentModel.countDocuments({ client: ids.practiceClient })).toBe(1)
  })

  it('answers 404 to everyone, the owner included, once the practice assessment is hidden', async () => {
    await AssessmentModel.updateOne({ _id: practiceAssessment }, { practice: 'hidden' })
    expect((await as('owner').get(`/api/clients/${ids.practiceClient}`)).status).toBe(404)
  })

  it('leaves a real client, site and document as they were', async () => {
    expect((await as('owner').get(`/api/clients/${ids.client}`)).status).toBe(200)
    expect((await as('admin').get(`/api/clients/${ids.client}`)).status).toBe(200)
    expect((await as('other').get(`/api/clients/${ids.client}/documents`)).status).toBe(200)
    expect((await as('admin').put(`/api/sites/${ids.site}`).send({})).status).toBe(400)
    expect((await as('other').delete(`/api/client-documents/${ids.document}`)).status).not.toBe(404)
  })
})

describe('no assessment can be created under a practice client or site (F-12)', () => {
  const create = (who: Viewer, payload: object) => as(who).post('/api/assessments').send(payload)
  const visits = () => AssessmentModel.countDocuments()
  const newSite = {
    name: 'Grays',
    address: 'Grays Road',
    jurisdiction: 'SG',
    facilityType: 'Mixed-use development',
  }

  it.each(['owner', 'other', 'admin'] as const)(
    'refuses %s as it refuses an unknown client',
    async (who) => {
      const before = await visits()
      const unknown = await create(
        who,
        oneAssessment({ clientId: String(new Types.ObjectId()), site: newSite }),
      )
      const onClient = await create(
        who,
        oneAssessment({ clientId: ids.practiceClient, site: newSite }),
      )
      const onSite = await create(
        who,
        oneAssessment({
          clientId: ids.practiceClient,
          siteId: ids.practiceSite,
          surveyType: 'Follow-up visit',
        }),
      )
      expect(unknown.status).toBe(400)
      expect(onClient.status).toBe(unknown.status)
      expect(onClient.body).toEqual(unknown.body)
      expect(onSite.status).toBe(unknown.status)
      expect(await visits()).toBe(before)
    },
  )

  it('refuses a real client with the practice site, and still creates under a real one', async () => {
    const before = await visits()
    const mixed = await create(
      'owner',
      oneAssessment({
        clientId: ids.client,
        siteId: ids.practiceSite,
        surveyType: 'Follow-up visit',
      }),
    )
    expect(mixed.status).toBe(400)
    expect(await visits()).toBe(before)
    const real = await create(
      'owner',
      oneAssessment({ clientId: ids.client, siteId: ids.site, surveyType: 'Follow-up visit' }),
    )
    expect(real.status).toBe(201)
  })

  it('keeps a renamed practice client out of reach by name', async () => {
    const rename = await as('owner')
      .put(`/api/clients/${ids.practiceClient}`)
      .send({ name: 'Northgate Logistics' })
    expect(rename.status).toBe(204)
    expect((await ClientModel.findById(ids.practiceClient).lean())?.key).toMatch(/^practice:/)

    const byName = await create(
      'other',
      oneAssessment({ client: 'Northgate Logistics', site: newSite }),
    )
    expect(byName.status).toBe(201)
    const site = await SiteModel.findOne({ name: 'Grays' }).lean()
    expect(String(site?.client)).not.toBe(ids.practiceClient)
  })

  it('refuses a practice client found by name (one renamed before its key was kept)', async () => {
    await ClientModel.updateOne({ _id: ids.practiceClient }, { key: 'northgate logistics' })
    const before = await visits()
    const byName = await create(
      'other',
      oneAssessment({ client: 'Northgate Logistics', site: newSite }),
    )
    expect(byName.status).toBe(400)
    expect(await visits()).toBe(before)
  })
})

describe("an insights summary on the practice client is costed as 'walkthrough' (F-12)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            statements: [{ text: 'A valve was found shut.', citations: ['O1'] }],
            missing: null,
            confidence: 'medium',
            dropped: 0,
            provenance: {
              provider: 'anthropic',
              model: 'claude-test',
              effort: 'medium',
              prompt_version: 'cp29-v1',
              privacy: { enabled: false, masked_count: 0 },
            },
            usage: [
              {
                feature: 'client-insights',
                billed_service: 'anthropic',
                model: 'claude-test',
                duration_ms: 900,
                input_tokens: 1200,
                output_tokens: 150,
                usage_status: 'recorded',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("records the owner's call as walkthrough, with no report", async () => {
    const res = await as('owner').post(`/api/clients/${ids.practiceClient}/insights/summary`)
    expect(res.status).toBe(201)
    const calls = await AiCallModel.find().lean()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ feature: 'walkthrough', userId: alex._id })
    expect(calls[0].reportId).toBeUndefined()
  })

  it("still records a real client's call as client-insights", async () => {
    const res = await as('owner').post(`/api/clients/${ids.client}/insights/summary`)
    expect(res.status).toBe(201)
    expect((await AiCallModel.find().lean()).map((c) => c.feature)).toEqual(['client-insights'])
  })
})
