// Assigning assessments to engineers (RV-11) through the HTTP routes: the picker's
// list, an admin choosing the engineer on create, reassigning, and who is told.
// Who may change what on someone else's assessment is in admin-read-only.test.ts.
import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { NotificationModel } from '../models/notification.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { oneAssessment } from './new-assessments'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

async function account(
  role: 'risk_engineer' | 'knowledge_admin',
  name: string,
  n: number,
  active = true,
) {
  const user = await UserModel.create({
    staffId: `T-${n}`,
    name,
    email: `u${n}@example.com`,
    role,
    active,
  })
  return { id: String(user._id), name, api: signedInAs(app, user) }
}

async function people() {
  return {
    sana: await account('knowledge_admin', 'Sana Patel', 1),
    omar: await account('knowledge_admin', 'Omar Khan', 2),
    jide: await account('risk_engineer', 'Jide Okafor', 3),
    alex: await account('risk_engineer', 'Alex Rowe', 4),
  }
}

const SITE = {
  name: 'Jurong Distribution Hub',
  address: '2 Jurong Port Road',
  jurisdiction: 'SG',
  facilityType: 'Distribution warehouse',
}
const visit = (engineerId?: string) => ({
  client: 'Straits Logistics',
  site: SITE,
  surveyType: 'First survey',
  siteVisitDate: '2026-10-05',
  reportDueDate: '2026-10-19',
  ...(engineerId ? { engineerId } : {}),
})

// The body of POST /api/assessments with an engineer on the one block.
function withEngineer(engineerId?: string, siteName = SITE.name) {
  const body = oneAssessment({ ...visit(), site: { ...SITE, name: siteName } })
  if (engineerId !== undefined)
    (body.sites[0].assessments[0] as Record<string, unknown>).engineerId = engineerId
  return body
}

type Who = Awaited<ReturnType<typeof people>>['sana']
const inboxOf = (who: Who) => who.api.get('/api/notifications?kind=inbox').then((r) => r.body.items)
const bellOf = (who: Who) => who.api.get('/api/notifications').then((r) => r.body.items)

async function assigned(admin: Who, engineer: Who, siteName?: string) {
  const created = await admin.api
    .post('/api/assessments')
    .send(withEngineer(engineer.id, siteName))
    .expect(201)
  return created.body.assessments[0] as { id: string; reference: string; engineer: { id: string } }
}

describe('GET /api/assessments/assignable-engineers', () => {
  it('lists active accounts by name, the caller included, with their role', async () => {
    const { sana } = await people()
    await account('risk_engineer', 'Left Firm', 9, false)

    const res = await sana.api.get('/api/assessments/assignable-engineers').expect(200)

    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Alex Rowe',
      'Jide Okafor',
      'Omar Khan',
      'Sana Patel',
    ])
    expect(res.body.items[3]).toEqual({ id: sana.id, name: 'Sana Patel', role: 'knowledge_admin' })
  })

  it('is refused to an engineer', async () => {
    const { jide } = await people()
    await jide.api.get('/api/assessments/assignable-engineers').expect(403)
  })
})

describe('creating an assessment for an engineer', () => {
  it('assigns the chosen engineer, lists it for them and gives them an Inbox item', async () => {
    const { sana, jide } = await people()

    const res = await sana.api.post('/api/assessments').send(withEngineer(jide.id)).expect(201)

    const row = res.body.assessments[0]
    expect(row.engineer).toEqual({ id: jide.id, name: 'Jide Okafor' })
    expect(
      (await jide.api.get('/api/assessments').expect(200)).body.map((a: { id: string }) => a.id),
    ).toEqual([row.id])
    const [item] = await inboxOf(jide)
    expect(item).toMatchObject({
      purpose: 'assessment_assigned',
      kind: 'inbox',
      message: 'New assessment: Jurong Distribution Hub',
      context: {
        reference: row.reference,
        assessmentId: row.id,
        client: 'Straits Logistics',
        site: 'Jurong Distribution Hub',
        reportDue: '2026-10-19',
        sender: 'Sana Patel',
      },
    })
  })

  it('leaves reportDue out when the assessment has no due date', async () => {
    const { sana, jide } = await people()
    const body = withEngineer(jide.id)
    delete (body.sites[0].assessments[0] as Record<string, unknown>).reportDueDate
    await sana.api.post('/api/assessments').send(body).expect(201)
    const [item] = await inboxOf(jide)
    expect(item.context).not.toHaveProperty('reportDue')
  })

  it('makes no Inbox item when an admin assigns it to themselves', async () => {
    const { sana } = await people()
    const res = await sana.api.post('/api/assessments').send(withEngineer(sana.id)).expect(201)
    expect(res.body.assessments[0].engineer.id).toBe(sana.id)
    expect(await NotificationModel.countDocuments()).toBe(0)
  })

  it('requires an admin to choose, naming the field', async () => {
    const { sana } = await people()
    const res = await sana.api.post('/api/assessments').send(withEngineer()).expect(400)
    expect(res.body.fields).toHaveProperty(['sites.0.assessments.0.engineerId'])
    expect(await AssessmentModel.countDocuments()).toBe(0)
  })

  it.each([
    ['an unknown account', () => String(new Types.ObjectId())],
    ['a malformed id', () => 'nobody'],
  ])('refuses %s, naming the field', async (_name, pick) => {
    const { sana } = await people()
    const res = await sana.api.post('/api/assessments').send(withEngineer(pick())).expect(400)
    expect(res.body.fields).toHaveProperty(['sites.0.assessments.0.engineerId'])
  })

  it('refuses an inactive account, naming the field', async () => {
    const { sana } = await people()
    const gone = await account('risk_engineer', 'Left Firm', 9, false)
    const res = await sana.api.post('/api/assessments').send(withEngineer(gone.id)).expect(400)
    expect(res.body.fields).toHaveProperty(['sites.0.assessments.0.engineerId'])
  })

  it('assigns each assessment on a form to its own engineer', async () => {
    const { sana, jide, alex } = await people()
    const body = oneAssessment(visit())
    body.sites[0].assessments = [
      { ref: 'a-1', visitType: 'First survey', engineerId: jide.id },
      { ref: 'a-2', visitType: 'Resurvey', engineerId: alex.id },
    ] as never

    const res = await sana.api.post('/api/assessments').send(body).expect(201)

    expect(
      res.body.assessments.map((a: { engineer: { name: string } }) => a.engineer.name),
    ).toEqual(['Jide Okafor', 'Alex Rowe'])
    expect(await inboxOf(jide)).toHaveLength(1)
    expect(await inboxOf(alex)).toHaveLength(1)
  })

  it('ignores an engineer an engineer names, and makes no Inbox item', async () => {
    const { alex, jide } = await people()
    const res = await alex.api.post('/api/assessments').send(withEngineer(jide.id)).expect(201)
    expect(res.body.assessments[0].engineer.id).toBe(alex.id)
    expect(await NotificationModel.countDocuments()).toBe(0)
  })

  it('lists every assessment, with its engineer, for an admin who holds none', async () => {
    const { sana, omar, jide } = await people()
    await assigned(omar, jide)
    const list = (await sana.api.get('/api/assessments').expect(200)).body
    expect(list).toHaveLength(1)
    expect(list[0].engineer).toEqual({ id: jide.id, name: 'Jide Okafor' })
  })
})

// Runs a reassign while another admin's write lands between its read and its write:
// the first updateOne call is preceded by `change` applied straight to the collection.
async function reassignRacing(
  who: Who,
  row: { id: string; reference: string },
  toId: string,
  change: Record<string, unknown>,
) {
  const original = AssessmentModel.updateOne.bind(AssessmentModel)
  vi.spyOn(AssessmentModel, 'updateOne').mockImplementationOnce(((...args: unknown[]) =>
    AssessmentModel.collection
      .updateOne({ _id: new Types.ObjectId(row.id) }, { $set: change })
      .then(() => (original as (...a: unknown[]) => unknown)(...args))) as never)
  return who.api.post(`/api/assessments/${row.reference}/reassign`).send({ engineerId: toId })
}

describe('POST /api/assessments/:reference/reassign', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses a move that raced another reassign, and tells nobody', async () => {
    const { sana, omar, jide, alex } = await people()
    const row = await assigned(sana, jide)
    const before = await NotificationModel.countDocuments()

    // Omar moves it to himself after Sana read it but before she wrote.
    const res = await reassignRacing(sana, row, alex.id, { engineer: new Types.ObjectId(omar.id) })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This assessment was just reassigned. Reload and try again.')
    expect((await AssessmentModel.findById(row.id).lean())?.engineer?.toString()).toBe(omar.id)
    expect(await NotificationModel.countDocuments()).toBe(before)
  })

  it('answers with the row and tells nobody when a racing move chose the same engineer', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    const before = await NotificationModel.countDocuments()

    const res = await reassignRacing(sana, row, alex.id, { engineer: new Types.ObjectId(alex.id) })

    expect(res.status).toBe(200)
    expect(res.body.engineer.id).toBe(alex.id)
    expect(await NotificationModel.countDocuments()).toBe(before)
  })

  it('answers archived, not reassigned, when an archive raced the move', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)

    const res = await reassignRacing(sana, row, alex.id, { archivedAt: new Date() })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/archived/i)
  })

  it('moves it to the new engineer, with its observations, and tells both', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    await ObservationModel.create({
      assessment: row.id,
      session: new Types.ObjectId(),
      engineer: 'Jide Okafor',
      engineerId: jide.id,
      note: 'Pallets in the fire lane.',
      severity: 'high',
      location: new Types.ObjectId(),
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: ['Protection'],
        effective_date: new Date(),
      },
    })

    const res = await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(200)

    // The updated row, in the shape of the Assessments list.
    expect(res.body).toMatchObject({
      id: row.id,
      reference: row.reference,
      engineer: { id: alex.id, name: 'Alex Rowe' },
      client: 'Straits Logistics',
      site: { name: 'Jurong Distribution Hub' },
    })
    expect((await jide.api.get('/api/assessments').expect(200)).body).toEqual([])
    expect((await alex.api.get('/api/assessments').expect(200)).body).toHaveLength(1)
    expect(await ObservationModel.countDocuments({ assessment: row.id })).toBe(1)

    // The new engineer gets an Inbox item; the old one an update in the bell and nothing in the Inbox.
    const [assigned_] = await inboxOf(alex)
    expect(assigned_).toMatchObject({
      message: 'New assessment: Jurong Distribution Hub',
      context: { reference: row.reference, sender: 'Sana Patel' },
    })
    expect(await inboxOf(jide)).toEqual([])
    const [moved] = await bellOf(jide)
    expect(moved).toMatchObject({
      purpose: 'assessment_moved',
      kind: 'bell',
      message: `${row.reference} moved to Alex Rowe`,
      context: { reference: row.reference, sender: 'Sana Patel', newEngineer: 'Alex Rowe' },
    })
  })

  it('takes the old engineer’s Inbox items for it away, and only theirs', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    const other = await assigned(sana, jide, 'Second Hub')
    const walkItem = (reference: string) =>
      NotificationModel.create({
        purpose: 'site_walk_ready',
        kind: 'inbox',
        message: 'Review site walk: Jurong Distribution Hub',
        targetRole: 'risk_engineer',
        targetUserIds: [jide.id],
        context: { reference, walkId: String(new Types.ObjectId()) },
      })
    await walkItem(row.reference)
    await walkItem(other.reference)
    expect(await inboxOf(jide)).toHaveLength(4)

    await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(200)

    const left = await inboxOf(jide)
    expect(left.map((i: { context: { reference: string } }) => i.context.reference).sort()).toEqual(
      [other.reference, other.reference].sort(),
    )
  })

  it('does not let the old engineer bring a removed item back', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    const [item] = await inboxOf(jide)

    await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(200)

    await jide.api.post(`/api/notifications/${item.id}/restore`).expect(404)
    expect(await inboxOf(jide)).toEqual([])
    const done = await jide.api.get('/api/notifications?kind=inbox&tab=done')
    expect(done.body.items).toEqual([])
  })

  it('moves its costs to the new engineer’s usage report', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    await AiCallModel.create({
      feature: 'draft-section',
      billedService: 'anthropic',
      model: 'claude-opus-5-5',
      reportId: row.reference,
      durationMs: 100,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      searchUnits: null,
      audioSeconds: null,
      usageStatus: 'recorded',
      estimatedCostUsd: 0.5,
      pricingBasis: 'Anthropic list price, 2026-10-08',
    } as never)
    const calls = async (who: Who) =>
      (await who.api.get('/api/usage/summary').expect(200)).body.totals.calls
    expect([await calls(jide), await calls(alex)]).toEqual([1, 0])

    await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(200)

    expect([await calls(jide), await calls(alex)]).toEqual([0, 1])
  })

  it('does nothing, and tells nobody, when it is already theirs', async () => {
    const { sana, jide } = await people()
    const row = await assigned(sana, jide)
    const before = await NotificationModel.countDocuments()

    const res = await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: jide.id })
      .expect(200)

    expect(res.body.engineer.id).toBe(jide.id)
    expect(await NotificationModel.countDocuments()).toBe(before)
  })

  it('makes no Inbox item when an admin takes it themselves, but still tells the old engineer', async () => {
    const { sana, jide } = await people()
    const row = await assigned(sana, jide)

    await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: sana.id })
      .expect(200)

    expect(await inboxOf(sana)).toEqual([])
    expect((await bellOf(jide)).map((i: { message: string }) => i.message)).toEqual([
      `${row.reference} moved to Sana Patel`,
    ])
  })

  it('does not tell an admin in their own bell when they move it away from themselves', async () => {
    const { sana, jide } = await people()
    const mine = await assigned(sana, sana)

    await sana.api
      .post(`/api/assessments/${mine.reference}/reassign`)
      .send({ engineerId: jide.id })
      .expect(200)

    expect(await bellOf(sana)).toEqual([])
    expect(await inboxOf(jide)).toHaveLength(1)
  })

  it('tells the old engineer by their current role, an admin included', async () => {
    const { sana, omar, jide } = await people()
    const row = await assigned(sana, omar)
    await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: jide.id })
      .expect(200)
    expect((await bellOf(omar)).map((i: { message: string }) => i.message)).toEqual([
      `${row.reference} moved to Jide Okafor`,
    ])
  })

  it('refuses an archived assessment with a clear message', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    await AssessmentModel.updateOne({ _id: row.id }, { archivedAt: new Date() })

    const res = await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(409)

    expect(res.body.error).toMatch(/archived/i)
    expect((await AssessmentModel.findById(row.id).lean())?.engineer?.toString()).toBe(jide.id)
  })

  it.each([
    ['no engineer', () => ({})],
    ['an unknown account', () => ({ engineerId: String(new Types.ObjectId()) })],
    ['a malformed id', () => ({ engineerId: 'nobody' })],
  ])('refuses %s, naming the field', async (_name, body) => {
    const { sana, jide } = await people()
    const row = await assigned(sana, jide)
    const res = await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send(body())
      .expect(400)
    expect(res.body.fields).toHaveProperty('engineerId')
  })

  it('refuses an inactive account', async () => {
    const { sana, jide } = await people()
    const gone = await account('risk_engineer', 'Left Firm', 9, false)
    const row = await assigned(sana, jide)
    const res = await sana.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: gone.id })
      .expect(400)
    expect(res.body.fields).toHaveProperty('engineerId')
  })

  it('answers 404 for an unknown assessment', async () => {
    const { sana, jide } = await people()
    await sana.api
      .post('/api/assessments/RPT-2099-0001/reassign')
      .send({ engineerId: jide.id })
      .expect(404)
  })

  it('is refused to an engineer, even for their own assessment', async () => {
    const { sana, jide, alex } = await people()
    const row = await assigned(sana, jide)
    await jide.api
      .post(`/api/assessments/${row.reference}/reassign`)
      .send({ engineerId: alex.id })
      .expect(403)
    expect(await SiteModel.countDocuments()).toBe(1)
  })
})
