// F-12 test seam 2: the practice filter (ADR 0003). One table: with a practice assessment
// seeded by hand (its own client, site, observations, OFI, draft, AI calls and attempted
// notifications), every list and count answers the same as without it, for its owner,
// another engineer and an admin. Only the owner's Assessments list gains it, as its first row.
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientModel } from '../models/client.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { NotificationModel } from '../models/notification.model'
import { ObservationModel } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { UserModel } from '../models/user.model'
import { recordAiCalls } from '../services/ai-usage.service'
import { dueReferences } from '../services/assistant/check-queue.service'
import { rankedFocus } from '../services/assistant/focus.service'
import { recordedClients } from '../services/client-intake.service'
import { tellBell } from '../services/generation/bell'
import { createNotification } from '../services/notification.service'
import { readChatEntities } from '../services/privacy.service'
import { notifyFailed, notifyReady } from '../services/site-walk-notice.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

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
const apiOf = (who: Viewer) => signedInAs(app, VIEWERS[who])

const DAY = 86_400_000
const soon = (days: number) => new Date(Date.now() + days * DAY)

// What the readers need of observations, OFIs, drafts and AI calls, stored raw.
const observe = (assessment: Types.ObjectId, severity: string) =>
  ObservationModel.collection.insertOne({
    assessment,
    session: new Types.ObjectId(),
    engineer: alex.name,
    note: 'Sprinkler valve found shut.',
    recordings: [],
    photos: [],
    severity,
    location: new Types.ObjectId(),
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
const acceptOfi = (assessment: Types.ObjectId) =>
  ReportOfiModel.collection.insertOne({
    assessment,
    state: 'accepted',
    priority: 'High',
    standards: [],
    precedent: null,
  })
const draft = (assessment: Types.ObjectId, cites: Types.ObjectId) =>
  ReportSectionModel.collection.insertOne({
    assessment,
    sectionId: '7',
    subsections: [{ statements: [{ text: 'x', citations: [`C:${cites}:1`], supported: true }] }],
    createdAt: new Date(),
  })
const wire = (feature = 'draft-section') => ({
  feature,
  billed_service: 'anthropic',
  model: 'claude-opus-5-5',
  duration_ms: 100,
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 0,
  usage_status: 'recorded',
})
const knowledgeDocument = (n: number) =>
  KnowledgeDocumentModel.create({
    title: `NFPA ${n}`,
    issuingBody: 'NFPA',
    edition: '2019',
    standardNumber: String(n),
    fileName: `nfpa-${n}.pdf`,
    file: { key: `k/${n}.pdf`, contentType: 'application/pdf', size: 10, sha256: `sha${n}` },
    status: 'complete',
    metadata: {
      source_type: 'nfpa_standard',
      jurisdiction: 'SG',
      facility_type: 'all',
      effective_date: new Date('2019-01-01'),
    },
    unconfirmed: [],
  })

// The real data set: one client, two sites, assessments for two engineers, their work,
// usage and a notification. `real` keeps the ids the table's endpoints need.
const real = {} as { client: Types.ObjectId; cited: Types.ObjectId; practiceOnly: Types.ObjectId }
beforeEach(async () => {
  await UserModel.create([alex, jide, sana])
  const client = await ClientModel.create({
    name: 'Northgate Logistics',
    key: 'northgate logistics',
  })
  const site = (code: string, name: string) =>
    SiteModel.create({
      code,
      name,
      jurisdiction: 'SG',
      facilityType: 'Warehouse',
      client: client._id,
    })
  const [tuas, jurong] = [await site('SITE-0001', 'Tuas'), await site('SITE-0002', 'Jurong')]
  const visit = (reference: string, onSite: typeof tuas, engineer: Types.ObjectId, due: number) =>
    AssessmentModel.create({
      reference,
      site: onSite._id,
      surveyType: 'First survey',
      engineer,
      siteVisitDate: soon(-3),
      reportDueDate: soon(due),
      siteContacts: [{ name: 'Mei Tan', role: 'Facilities' }],
    })
  const a1 = await visit('RPT-2026-0001', tuas, alex._id, 2)
  await visit('RPT-2026-0002', jurong, alex._id, 20)
  const a3 = await visit('RPT-2026-0003', tuas, jide._id, 5)
  await Promise.all([observe(a1._id, 'high'), observe(a1._id, 'low'), observe(a3._id, 'critical')])
  await acceptOfi(a1._id)
  const [cited, practiceOnly] = [await knowledgeDocument(1), await knowledgeDocument(2)]
  await draft(a1._id, cited._id)
  await recordAiCalls([wire()], { reportId: 'RPT-2026-0001', section: '7' })
  await recordAiCalls([wire()], { reportId: 'RPT-2026-0003', section: '7' })
  await recordAiCalls([wire('chat')], { userId: String(alex._id) })
  await ClientDocumentModel.collection.insertMany(
    [{ kind: 'client' }, { kind: 'assessment', site: tuas._id, assessment: a1._id }].map((p) => ({
      client: client._id,
      placement: p,
      name: 'Request.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: 'x',
      key: 'k',
      origin: 'upload',
      uploaded: { at: new Date(), by: { id: String(alex._id), name: alex.name } },
    })),
  )
  await createNotification({
    purpose: 'assessment_assigned',
    message: 'New assessment: Tuas',
    targetRole: 'risk_engineer',
    targetUserIds: [String(alex._id)],
    context: { reference: 'RPT-2026-0001' },
  })
  Object.assign(real, { client: client._id, cited: cited._id, practiceOnly: practiceOnly._id })
})

// The practice set, seeded by hand the way the contract describes: a live practice assessment
// for the owner on its made-up client and site, plus an earlier one hidden by a reset. Its work,
// its AI call (through the recorder), and every notification its background jobs would send.
async function seedPractice() {
  const client = await ClientModel.create({
    name: 'Harbourline Cold Store (practice)',
    key: `harbourline cold store (practice) ${alex._id}`,
    practice: true,
  })
  const site = await SiteModel.create({
    code: `PRACTICE-SITE-${alex._id}`,
    name: 'Harbourline Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Cold store',
    client: client._id,
    practice: true,
  })
  const practice = (reference: string, state: 'live' | 'hidden') =>
    AssessmentModel.create({
      reference,
      site: site._id,
      surveyType: 'First survey',
      engineer: alex._id,
      siteVisitDate: soon(-1),
      reportDueDate: soon(1),
      practice: state,
    })
  const live = await practice('PRACTICE-0001', 'live')
  await practice('PRACTICE-0000', 'hidden')
  await Promise.all([observe(live._id, 'critical'), observe(live._id, 'high')])
  await acceptOfi(live._id)
  await draft(live._id, real.practiceOnly)
  await recordAiCalls([wire()], { reportId: 'PRACTICE-0001', section: '7' })
  // What its drafting, site walks and any other producer would send.
  await tellBell('PRACTICE-0001', 'ready', 'Section 7 is ready')
  const walk = await SiteWalkModel.collection.insertOne({
    assessment: live._id,
    engineerId: String(alex._id),
    status: 'failed',
    error: 'x',
  })
  await notifyReady({ _id: walk.insertedId, assessment: live._id })
  await notifyFailed(walk.insertedId)
  await createNotification({
    purpose: 'assessment_status',
    message: 'x',
    targetRole: 'risk_engineer',
    targetUserIds: ['all'],
    context: { reference: 'PRACTICE-0001' },
  })
  return live
}

type Answer = { status: number; body: unknown }
const http = async (who: Viewer, url: string): Promise<Answer> => {
  const { status, body } = await apiOf(who).get(url)
  return { status, body }
}

// Usage: walkthrough calls are their own feature and group (walkthrough-usage.test.ts), so
// only what is attributed to assessments and other features must stay the same.
type Group = { key: string; segments: Record<string, number> } & Record<string, unknown>
const withoutWalkthrough = (segments: Record<string, number>) =>
  Object.fromEntries(Object.entries(segments).filter(([k]) => k !== 'walkthrough'))
const summary = async (who: Viewer) => {
  const { status, body } = await http(who, '/api/usage/summary')
  const b = body as {
    reports: string[]
    byFeature: { key: string }[]
    byFeatureService: { feature: string }[]
  }
  return {
    status,
    reports: b.reports,
    byFeature: b.byFeature.filter((f) => f.key !== 'walkthrough'),
    byFeatureService: b.byFeatureService.filter((f) => f.feature !== 'walkthrough'),
  }
}
const overview = (groupBy: string) => async (who: Viewer) => {
  const { status, body } = await http(
    who,
    `/api/usage/overview?groupBy=${groupBy}&split=feature&range=all`,
  )
  const groups = (body as { groups: Group[] }).groups
  return {
    status,
    groups: groups
      .filter((g) => g.key !== 'walkthrough')
      .map(({ key, label, reference, client, siteName, engineerId, engineerName, segments }) => ({
        key,
        label,
        reference,
        client,
        siteName,
        engineerId,
        engineerName,
        segments: withoutWalkthrough(segments),
      })),
  }
}

// Every list and count, read as one viewer. GET /api/assessments has its own test below.
const TABLE: [string, (who: Viewer) => Promise<unknown>][] = [
  ['the Focus ranking', (who) => rankedFocus(String(VIEWERS[who]._id))],
  ['the clients list', (who) => http(who, '/api/clients')],
  ['a client page', (who) => http(who, `/api/clients/${real.client}`)],
  ["a client's site picker", (who) => http(who, `/api/clients/${real.client}/sites`)],
  ['client insights', (who) => http(who, `/api/clients/${real.client}/insights`)],
  ['client documents', (who) => http(who, `/api/clients/${real.client}/documents`)],
  ['the Tag picker', (who) => http(who, `/api/clients/${real.client}/document-tags`)],
  ['the usage summary', summary],
  ['the usage overview by assessment', overview('assessment')],
  ['the usage overview by engineer', overview('engineer')],
  ['the notification counts', (who) => http(who, '/api/notifications/count')],
  ['the Inbox', (who) => http(who, '/api/notifications?kind=inbox')],
  ['the bell', (who) => http(who, '/api/notifications')],
  [
    'the knowledge documents "in use" check',
    (who) => http(who, '/api/knowledge-documents/ingested'),
  ],
  ["intake's known clients", () => recordedClients()],
  ["chat's masked details", () => readChatEntities()],
  ["the daily re-check's due list", () => dueReferences()],
]

const readAll = async <T>(read: (who: Viewer) => Promise<T>) => ({
  owner: await read('owner'),
  other: await read('other'),
  admin: await read('admin'),
})

describe('the practice assessment is left out of every list and count (F-12)', () => {
  it.each(TABLE)('%s answers the same for everyone with it present', async (_name, read) => {
    const without = await readAll(read)
    await seedPractice()
    expect(await readAll(read)).toEqual(without)
  })

  it("adds exactly one row, first, to its owner's own Assessments list, and to no one else's", async () => {
    const without = await readAll((who) => http(who, '/api/assessments'))
    await seedPractice()
    const withIt = await readAll((who) => http(who, '/api/assessments'))

    expect(withIt.other).toEqual(without.other)
    expect(withIt.admin).toEqual(without.admin)
    const [first, ...rest] = withIt.owner.body as { reference: string; practice?: true }[]
    expect(first).toMatchObject({ reference: 'PRACTICE-0001', practice: true })
    expect(rest).toEqual(without.owner.body)
    expect(rest.some((a) => 'practice' in a)).toBe(false)
  })

  it('never shows a hidden practice assessment, even to its owner', async () => {
    await seedPractice()
    for (const who of ['owner', 'other', 'admin'] as const) {
      const { body } = await http(who, '/api/assessments')
      expect(JSON.stringify(body)).not.toContain('PRACTICE-0000')
    }
    expect((await apiOf('owner').get('/api/assessments/PRACTICE-0000/observations')).status).toBe(
      404,
    )
  })

  it('makes no notification or Inbox item for anyone', async () => {
    await seedPractice()
    expect(await NotificationModel.countDocuments({ 'context.reference': /^PRACTICE-/ })).toBe(0)
  })

  it("records its AI calls under 'walkthrough', never against the assessment", async () => {
    await seedPractice()
    expect(await AiCallModel.countDocuments({ reportId: /^PRACTICE-/ })).toBe(0)
    expect(await AiCallModel.countDocuments({ feature: 'walkthrough', userId: alex._id })).toBe(1)
  })
})

describe('opening, archiving and reassigning a practice assessment (F-12)', () => {
  beforeEach(seedPractice)

  it('opens for its owner, and answers 404 to anyone else, an admin included', async () => {
    const path = '/api/assessments/PRACTICE-0001/observations'
    expect((await apiOf('owner').get(path)).status).toBe(200)
    expect((await apiOf('other').get(path)).status).toBe(404)
    expect((await apiOf('admin').get(path)).status).toBe(404)
    expect((await apiOf('admin').post('/api/assessments/PRACTICE-0001/archive')).status).toBe(404)
  })

  it('cannot be archived by its owner (409)', async () => {
    const res = await apiOf('owner').post('/api/assessments/PRACTICE-0001/archive')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/practice/i)
    expect((await AssessmentModel.findOne({ reference: 'PRACTICE-0001' }).lean())?.archivedAt).toBe(
      undefined,
    )
  })

  it("cannot be reassigned, even by an admin who owns it (409); another's is 404", async () => {
    const site = (await AssessmentModel.findOne({ reference: 'PRACTICE-0001' }).lean())!.site
    await AssessmentModel.create({
      reference: 'PRACTICE-0002',
      site,
      surveyType: 'First survey',
      engineer: sana._id,
      practice: 'live',
    })
    const admin = apiOf('admin')
    const own = await admin
      .post('/api/assessments/PRACTICE-0002/reassign')
      .send({ engineerId: String(jide._id) })
    expect(own.status).toBe(409)
    expect(own.body.error).toMatch(/practice/i)
    const theirs = await admin
      .post('/api/assessments/PRACTICE-0001/reassign')
      .send({ engineerId: String(jide._id) })
    expect(theirs.status).toBe(404)
    expect(
      (await AssessmentModel.findOne({ reference: 'PRACTICE-0002' }).lean())?.engineer,
    ).toEqual(sana._id)
  })
})
