// RV-11: a knowledge admin now holds assessments:edit and reports:generate, so
// every route those two open to them must still refuse a change to an assessment
// that is not theirs. Also: after a reassignment, the new engineer can change the
// assessment's observations, locations and site walks, and the old one cannot.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ObservationModel } from '../models/observation.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { findOrCreateClient } from '../services/client.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

async function account(role: 'risk_engineer' | 'knowledge_admin', name: string, n: number) {
  const user = await UserModel.create({
    staffId: `T-${n}`,
    name,
    email: `u${n}@example.com`,
    role,
    active: true,
  })
  return { id: String(user._id), name, api: signedInAs(app, user) }
}

const REF = 'RPT-2026-0100'
const BAY = new Types.ObjectId()

// Alex's assessment with a location, an active capture session, an observation
// with a failed recording and a failed page, a site walk being recorded and a
// client document tagged to it.
async function world() {
  const sana = await account('knowledge_admin', 'Sana Patel', 1)
  const omar = await account('knowledge_admin', 'Omar Khan', 2)
  const alex = await account('risk_engineer', 'Alex Rowe', 3)
  const jide = await account('risk_engineer', 'Jide Okafor', 4)
  const client = await findOrCreateClient('Straits Logistics')
  const site = await SiteModel.create({
    code: 'SITE-1',
    name: 'Tilbury DC',
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
    client: client._id,
  })
  const assessment = await AssessmentModel.create({
    reference: REF,
    site: site._id,
    surveyType: 'First survey',
    engineer: alex.id,
    locations: [{ _id: BAY, name: 'Bay 3', key: 'bay 3||' }],
  })
  const session = await CaptureSessionModel.create({ assessment: assessment._id, status: 'active' })
  const observation = await ObservationModel.create({
    assessment: assessment._id,
    session: session._id,
    engineer: 'Alex Rowe',
    engineerId: alex.id,
    note: 'Pallets in the fire lane.',
    recordings: [
      {
        name: 'R1',
        key: 'k/r1.webm',
        contentType: 'audio/webm',
        size: 3,
        transcription: { status: 'failed', error: 'x' },
      },
    ],
    pages: [
      {
        name: 'P1',
        key: 'k/p1.jpg',
        contentType: 'image/jpeg',
        size: 3,
        transcription: { status: 'failed', error: 'x' },
      },
    ],
    severity: 'high',
    location: BAY,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Distribution warehouse',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
  const walk = await SiteWalkModel.create({
    assessment: assessment._id,
    engineerId: alex.id,
    status: 'recording',
    metadata: {
      source_type: 'site_walk',
      jurisdiction: 'SG',
      facility_type: 'Distribution warehouse',
      effective_date: new Date(),
    },
  })
  const document = await ClientDocumentModel.create({
    client: client._id,
    placement: { kind: 'assessment', site: site._id, assessment: assessment._id },
    name: 'Scope.pdf',
    contentType: 'application/pdf',
    size: 3,
    sha256: 'abc',
    key: 'client-documents/x.pdf',
    origin: 'upload',
    uploaded: { at: new Date(), by: { id: alex.id, name: 'Alex Rowe' } },
    metadata: {
      source_type: 'client_document',
      jurisdiction: 'SG',
      facility_type: 'Distribution warehouse',
      COPE_dimension: null,
      effective_date: new Date(),
    },
  })
  return {
    sana,
    omar,
    alex,
    jide,
    clientId: String(client._id),
    siteId: String(site._id),
    observationId: String(observation._id),
    recordingId: String(observation.recordings[0]._id),
    pageId: String(observation.pages![0]._id),
    walkId: String(walk._id),
    documentId: String(document._id),
  }
}

type W = Awaited<ReturnType<typeof world>>
type Api = W['sana']['api']
type Call = (api: Api, w: W) => Promise<{ status: number }>

const a = `/api/assessments/${REF}`
const DRAFT = '6ab39017e45cf009e4507731'

// Every route that assessments:edit or reports:generate opens to a knowledge
// admin and that changes an assessment's work. Each must answer 403 to an admin
// who is not the assigned engineer.
const CHANGES: [name: string, call: Call][] = [
  ['start capture', (u) => u.post(`${a}/capture-session`)],
  ['edit the assessment', (u) => u.put(a).send({ surveyType: 'Resurvey' })],
  ['archive', (u) => u.post(`${a}/archive`)],
  ['restore', (u) => u.post(`${a}/restore`)],
  ['add a location', (u) => u.post(`${a}/locations`).send({ name: 'Roof' })],
  ['edit a location', (u) => u.patch(`${a}/locations/${BAY}`).send({ name: 'Bay 4' })],
  ['remove a location', (u) => u.delete(`${a}/locations/${BAY}`)],
  [
    'save an observation',
    (u) =>
      u.post(`${a}/observations`).field(
        'details',
        JSON.stringify({
          copeDimensions: ['Protection'],
          severity: 'high',
          locationId: String(BAY),
          note: 'x',
        }),
      ),
  ],
  [
    'edit an observation',
    (u, w) => u.patch(`/api/observations/${w.observationId}`).send({ note: 'y' }),
  ],
  ['delete an observation', (u, w) => u.delete(`/api/observations/${w.observationId}`)],
  ['restore an observation', (u, w) => u.post(`/api/observations/${w.observationId}/restore`)],
  [
    'retry a transcription',
    (u, w) =>
      u.post(
        `/api/observations/${w.observationId}/recordings/${w.recordingId}/transcription/retry`,
      ),
  ],
  [
    'retry a page',
    (u, w) => u.post(`/api/observations/${w.observationId}/pages/${w.pageId}/transcription/retry`),
  ],
  [
    'retranscribe a page',
    (u, w) => u.post(`/api/observations/${w.observationId}/pages/${w.pageId}/retranscribe`),
  ],
  [
    'read an observation with AI',
    (u, w) => u.post(`/api/observations/${w.observationId}/interpretation`),
  ],
  ['draft a section', (u) => u.post(`${a}/sections/7/draft`)],
  [
    'accept a finding',
    (u) => u.post(`${a}/sections/7/findings/f1/accept`).send({ draftId: DRAFT }),
  ],
  [
    'edit a finding',
    (u) => u.put(`${a}/sections/7/findings/f1`).send({ draftId: DRAFT, text: 'New wording.' }),
  ],
  ['accept all findings', (u) => u.post(`${a}/sections/7/bulk-accept`).send({ draftId: DRAFT })],
  ['regenerate a section', (u) => u.post(`${a}/sections/7/regenerate`).send({})],
  [
    'accept a replacement',
    (u) => u.post(`${a}/sections/7/replacement/accept`).send({ draftId: DRAFT }),
  ],
  ['draft the summary', (u) => u.post(`${a}/summary/draft`)],
  ['save the appendix', (u) => u.put(`${a}/appendix`).send({ photos: [] })],
  ['propose scores', (u) => u.post(`${a}/risk-quality/propose`)],
  ['propose losses', (u) => u.post(`${a}/loss-estimates/propose`)],
  ['draft improvements', (u) => u.post(`${a}/ofis/draft`)],
  ['accept an improvement', (u) => u.post(`${a}/ofis/${DRAFT}/accept`)],
  ['make a checklist', (u) => u.post(`${a}/checklist`).send({ standardIds: [DRAFT] })],
  [
    'mark a checklist item',
    (u) => u.put(`${a}/checklist/items/${DRAFT}/mark`).send({ mark: null }),
  ],
  [
    'add a checklist item',
    (u) =>
      u
        .post(`${a}/checklist/items`)
        .send({ area: '7', text: 'Check the cladding.', COPE_dimension: ['Construction'] }),
  ],
  [
    'edit a checklist item',
    (u) => u.patch(`${a}/checklist/items/${DRAFT}`).send({ text: 'New wording.' }),
  ],
  ['remove a checklist item', (u) => u.post(`${a}/checklist/items/${DRAFT}/remove`)],
  ['restore a checklist item', (u) => u.post(`${a}/checklist/items/${DRAFT}/restore`)],
  ['start a site walk', (u) => u.post(`${a}/site-walks`)],
  [
    'type into a site walk',
    (u, w) => u.put(`${a}/site-walks/${w.walkId}/text`).send({ text: 'x' }),
  ],
  [
    'finish a site walk',
    (u, w) => u.post(`${a}/site-walks/${w.walkId}/finish`).send({ name: 'Walk' }),
  ],
  ['discard a site walk', (u, w) => u.delete(`${a}/site-walks/${w.walkId}`)],
  [
    'retag a client document',
    (u, w) =>
      u.patch(`/api/client-documents/${w.documentId}`).send({ placement: { kind: 'client' } }),
  ],
  ['delete a client document', (u, w) => u.delete(`/api/client-documents/${w.documentId}`)],
  [
    'correct a site',
    (u, w) =>
      u.put(`/api/sites/${w.siteId}`).send({
        name: 'Renamed',
        jurisdiction: 'SG',
        facilityType: 'Distribution warehouse',
      }),
  ],
  ['remove a site', (u, w) => u.post(`/api/sites/${w.siteId}/remove`)],
  ['rename a client', (u, w) => u.put(`/api/clients/${w.clientId}`).send({ name: 'Other name' })],
  ['remove a client', (u, w) => u.post(`/api/clients/${w.clientId}/remove`)],
]

describe('an admin on someone else’s assessment', () => {
  it.each(CHANGES)('cannot %s', async (_name, call) => {
    const w = await world()
    const res = await call(w.sana.api, w)
    expect(res.status).toBe(403)
  })

  it('can read the workspace', async () => {
    const w = await world()
    for (const path of [
      `${a}/observations`,
      `${a}/locations`,
      `${a}/site-walks`,
      `${a}/site-walks/${w.walkId}`,
      `${a}/ofis`,
    ])
      expect((await w.sana.api.get(path)).status, path).toBe(200)
  })

  it('cannot upload a document to a client where they hold no assessment', async () => {
    const w = await world()
    const res = await w.sana.api
      .post(`/api/clients/${w.clientId}/documents`)
      .attach('file', Buffer.from('%PDF-1.4 x'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      })
    expect(res.status).toBe(403)
    expect(await ClientDocumentModel.countDocuments()).toBe(1)
  })

  it('keeps Alex’s assessment unchanged after all of that', async () => {
    const w = await world()
    for (const [, call] of CHANGES) await call(w.sana.api, w)
    const stored = await AssessmentModel.findOne({ reference: REF }).lean()
    expect(String(stored?.engineer)).toBe(w.alex.id)
    expect(stored?.surveyType).toBe('First survey')
    expect(stored?.archivedAt).toBeUndefined()
    expect(stored?.locations).toHaveLength(1)
    expect(await ObservationModel.countDocuments({ deleted: { $exists: true } })).toBe(0)
    expect(await ClientDocumentModel.countDocuments()).toBe(1)
    expect(await SiteWalkModel.countDocuments()).toBe(1)
  })
})

describe('after a reassignment', () => {
  async function reassigned() {
    const w = await world()
    await w.sana.api.post(`${a}/reassign`).send({ engineerId: w.jide.id }).expect(200)
    return w
  }

  it('lets the new engineer edit an existing observation and refuses the old one', async () => {
    const w = await reassigned()
    const url = `/api/observations/${w.observationId}`
    expect((await w.alex.api.patch(url).send({ note: 'Old engineer.' })).status).toBe(403)
    const res = await w.jide.api.patch(url).send({ note: 'New engineer.' })
    expect(res.status).toBe(200)
    expect(res.body.note).toBe('New engineer.')
  })

  it('lets the new engineer edit its locations and refuses the old one', async () => {
    const w = await reassigned()
    const url = `${a}/locations/${BAY}`
    expect((await w.alex.api.patch(url).send({ name: 'Bay 9' })).status).toBe(403)
    expect((await w.jide.api.patch(url).send({ name: 'Bay 9' })).status).toBe(200)
  })

  it('lets the new engineer change the old engineer’s site walk and refuses the old one', async () => {
    const w = await reassigned()
    const url = `${a}/site-walks/${w.walkId}/text`
    expect((await w.alex.api.put(url).send({ text: 'Old.' })).status).toBe(403)
    const res = await w.jide.api.put(url).send({ text: 'New.' })
    expect(res.status).toBe(200)
    expect(res.body.typedText).toBe('New.')
  })

  it('shows the new engineer the walks already made on the assessment', async () => {
    const w = await reassigned()
    const listed = await w.jide.api.get(`${a}/site-walks`).expect(200)
    expect(listed.body.map((x: { id: string }) => x.id)).toEqual([w.walkId])
  })

  it('lets the new engineer start drafting and refuses the old one', async () => {
    const w = await reassigned()
    // 503 is the drafting service being down in tests: reached only after the ownership check passes.
    expect((await w.alex.api.post(`${a}/sections/7/draft`)).status).toBe(403)
    expect((await w.jide.api.post(`${a}/sections/7/draft`)).status).toBe(503)
  })
})
