// The Inbox (F-10) through the HTTP routes: which notifications are Inbox items
// and which bell, and what To do and Done mean for each of two admins who share
// one item. Routing for the producers that live in other features (assignment,
// site walks) is asserted beside those features' tests.
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { KnowledgeGapRequestModel } from '../models/knowledge-gap-request.model'
import { NotificationModel } from '../models/notification.model'
import { UserModel } from '../models/user.model'
import { createNotification } from '../services/notification.service'
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
  return { id: String(user._id), api: signedInAs(app, user) }
}

async function people() {
  return {
    sana: await account('knowledge_admin', 'Sana Patel', 1),
    omar: await account('knowledge_admin', 'Omar Khan', 2),
    jide: await account('risk_engineer', 'Jide Okafor', 3),
  }
}

// An Inbox item for every admin, made the way the gateway makes a new knowledge request.
const sharedItem = () =>
  createNotification({
    purpose: 'knowledge_gap_request',
    message: 'New knowledge request',
    targetRole: 'knowledge_admin',
    targetUserIds: ['all'],
    context: { requestId: 'r1', question: 'What density?', askedBy: 'Jide Okafor' },
  })

type Item = { id: string; message: string }
const ids = async (who: { api: ReturnType<typeof signedInAs> }, tab: 'todo' | 'done') =>
  (await who.api.get(`/api/notifications?kind=inbox&tab=${tab}`).expect(200)).body.items.map(
    (i: Item) => i.id,
  )

describe('which notifications are Inbox items', () => {
  const post = (body: object) =>
    request(app)
      .post('/api/internal/notifications')
      .set('x-service-key', config.serviceApiKey!)
      .send({
        message: 'x',
        targetRole: 'knowledge_admin',
        targetUserIds: ['all'],
        createdByService: 'ingestion-service',
        ...body,
      })
      .expect(201)
  const kindOf = async (id: string) => (await NotificationModel.findById(id).lean())?.kind

  it('puts a failed or needs-review document in the Inbox and a finished one in the bell', async () => {
    const ingestion = (status: string) =>
      post({ purpose: 'ingestion_status', context: { documentId: `d-${status}`, status } })
    expect(await kindOf((await ingestion('failed')).body.id)).toBe('inbox')
    expect(await kindOf((await ingestion('needs_review')).body.id)).toBe('inbox')
    expect(await kindOf((await ingestion('complete')).body.id)).toBe('bell')
  })

  it('applies the same rule to any purpose posted by another service', async () => {
    const created = await post({
      purpose: 'assessment_assigned',
      targetRole: 'risk_engineer',
      targetUserIds: ['u1'],
    })
    expect(await kindOf(created.body.id)).toBe('inbox')
    expect(created.body.kind).toBe('inbox')
  })

  it('puts a new knowledge request in the Inbox and its outcome in the bell', async () => {
    const { sana, jide } = await people()
    const asked = await jide.api.post('/api/knowledge-gaps').send({ question: 'Q?' }).expect(201)
    expect(
      await NotificationModel.findOne({ 'context.requestId': asked.body.id }).lean(),
    ).toMatchObject({
      kind: 'inbox',
      context: { askedBy: 'Jide Okafor', question: 'Q?', requestId: asked.body.id },
    })

    await sana.api
      .post(`/api/knowledge-gaps/${asked.body.id}/dismiss`)
      .send({ reason: 'No.' })
      .expect(200)
    const outcome = await NotificationModel.findOne({
      'context.requestId': asked.body.id,
      'context.status': 'dismissed',
    }).lean()
    expect(outcome?.kind).toBe('bell')
    // The asker is told in the bell, addressed by their current role.
    expect(outcome).toMatchObject({ targetRole: 'risk_engineer', targetUserIds: [jide.id] })
    expect(await KnowledgeGapRequestModel.countDocuments()).toBe(1)
  })

  it('addresses an outcome to the asker by their current role, not the one they asked with', async () => {
    const { sana, jide } = await people()
    const asked = await jide.api.post('/api/knowledge-gaps').send({ question: 'Q?' }).expect(201)
    await UserModel.updateOne({ _id: jide.id }, { role: 'knowledge_admin' })

    await sana.api
      .post(`/api/knowledge-gaps/${asked.body.id}/dismiss`)
      .send({ reason: 'No.' })
      .expect(200)

    expect(await NotificationModel.findOne({ 'context.status': 'dismissed' }).lean()).toMatchObject(
      { targetRole: 'knowledge_admin', targetUserIds: [jide.id] },
    )
  })

  it('treats a notification saved before F-10, with no kind, as a bell one', async () => {
    const { sana } = await people()
    await NotificationModel.collection.insertOne({
      purpose: 'ingestion_status',
      message: 'Old one',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
      readBy: [],
      dismissedBy: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const bell = (await sana.api.get('/api/notifications').expect(200)).body
    expect(bell.items.map((i: Item) => i.message)).toEqual(['Old one'])
    expect(bell.items[0].kind).toBe('bell')
    expect((await sana.api.get('/api/notifications?kind=inbox').expect(200)).body.items).toEqual([])
  })
})

describe('GET /api/notifications for the Inbox', () => {
  it('lists only the bell by default and only the Inbox when asked', async () => {
    const { sana } = await people()
    await sharedItem()
    await createNotification({
      purpose: 'ingestion_status',
      message: 'Finished',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })

    const bell = (await sana.api.get('/api/notifications').expect(200)).body
    expect(bell.items.map((i: Item) => i.message)).toEqual(['Finished'])
    expect(bell).toMatchObject({ total: 1, unread: 1, inboxTodo: 1 })

    const inbox = (await sana.api.get('/api/notifications?kind=inbox').expect(200)).body
    expect(inbox.items.map((i: Item) => i.message)).toEqual(['New knowledge request'])
    expect(inbox).toMatchObject({ total: 1, unread: 1, inboxTodo: 1 })
  })

  it('shapes an item for the client without leaking who else read or dismissed it', async () => {
    const { sana } = await people()
    await sharedItem()
    const [item] = (await sana.api.get('/api/notifications?kind=inbox').expect(200)).body.items
    expect(item).toMatchObject({
      kind: 'inbox',
      done: false,
      doneAt: null,
      context: { askedBy: 'Jide Okafor' },
    })
    for (const key of ['readBy', 'dismissedBy', 'targetUserIds', 'doneBy', 'targetShared'])
      expect(item).not.toHaveProperty(key)
  })

  it('names the field for a bad kind or tab', async () => {
    const { sana } = await people()
    const kind = await sana.api.get('/api/notifications?kind=mail').expect(400)
    expect(kind.body.fields).toHaveProperty('kind')
    const tab = await sana.api.get('/api/notifications?kind=inbox&tab=later').expect(400)
    expect(tab.body.fields).toHaveProperty('tab')
  })

  it('pages the Inbox and reports the total across pages', async () => {
    const { sana } = await people()
    for (let n = 0; n < 3; n++) await sharedItem()
    const page = (await sana.api.get('/api/notifications?kind=inbox&limit=2&offset=2').expect(200))
      .body
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(3)
  })
})

describe('To do and Done for two admins sharing one item', () => {
  it('moves an opened item to Done for that admin only', async () => {
    const { sana, omar } = await people()
    const item = await sharedItem()

    await sana.api.patch(`/api/notifications/${item.id}/read`).expect(204)

    expect(await ids(sana, 'todo')).toEqual([])
    expect(await ids(sana, 'done')).toEqual([item.id])
    expect(await ids(omar, 'todo')).toEqual([item.id])
    expect(await ids(omar, 'done')).toEqual([])
  })

  it('moves a ticked item to Done for every admin, without opening it', async () => {
    const { sana, omar } = await people()
    const item = await sharedItem()

    await sana.api.post(`/api/notifications/${item.id}/done`).expect(204)

    for (const who of [sana, omar]) {
      expect(await ids(who, 'todo')).toEqual([])
      expect(await ids(who, 'done')).toEqual([item.id])
    }
    const [done] = (await omar.api.get('/api/notifications?kind=inbox&tab=done').expect(200)).body
      .items
    expect(done).toMatchObject({ done: true })
    expect(done.doneAt).toEqual(expect.any(String))
  })

  it('brings an unticked item back to To do, except for an admin who opened it', async () => {
    const { sana, omar } = await people()
    const item = await sharedItem()
    await omar.api.patch(`/api/notifications/${item.id}/read`).expect(204)
    await sana.api.post(`/api/notifications/${item.id}/done`).expect(204)

    await sana.api.delete(`/api/notifications/${item.id}/done`).expect(204)

    expect(await ids(sana, 'todo')).toEqual([item.id])
    expect(await ids(omar, 'todo')).toEqual([])
    expect(await ids(omar, 'done')).toEqual([item.id])
    const [back] = (await sana.api.get('/api/notifications?kind=inbox').expect(200)).body.items
    expect(back).toMatchObject({ done: false, doneAt: null })
  })

  it('unticks an item the admin only opened, putting it back in their To do', async () => {
    const { sana } = await people()
    const item = await sharedItem()
    await sana.api.patch(`/api/notifications/${item.id}/read`).expect(204)

    await sana.api.delete(`/api/notifications/${item.id}/done`).expect(204)

    expect(await ids(sana, 'todo')).toEqual([item.id])
  })

  it('bins an item for one admin only, and restores it', async () => {
    const { sana, omar } = await people()
    const item = await sharedItem()

    await sana.api.post(`/api/notifications/${item.id}/dismiss`).expect(204)
    expect(await ids(sana, 'todo')).toEqual([])
    expect(await ids(sana, 'done')).toEqual([])
    expect(await ids(omar, 'todo')).toEqual([item.id])

    await sana.api.post(`/api/notifications/${item.id}/restore`).expect(204)
    expect(await ids(sana, 'todo')).toEqual([item.id])
  })

  it('counts the To do items in the count endpoint and the session payload', async () => {
    const { sana } = await people()
    const item = await sharedItem()
    await sharedItem()
    await createNotification({
      purpose: 'ingestion_status',
      message: 'Finished',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })

    expect((await sana.api.get('/api/notifications/count').expect(200)).body).toEqual({
      total: 1,
      unread: 1,
      inboxTodo: 2,
    })
    await sana.api.post(`/api/notifications/${item.id}/done`).expect(204)
    expect((await sana.api.get('/api/auth/me').expect(200)).body.notifications).toEqual({
      total: 1,
      unread: 1,
      inboxTodo: 1,
    })
  })

  it('does not extend the session when the count is polled', async () => {
    const { sana } = await people()
    const response = await sana.api.get('/api/notifications/count').expect(200)
    expect(response.headers['set-cookie']).toBeUndefined()
  })
})

describe('the bell buttons never touch the Inbox', () => {
  it('leaves Inbox items when marking all read', async () => {
    const { sana } = await people()
    const item = await sharedItem()
    await sana.api.post('/api/notifications/read-all').expect(204)
    expect(await ids(sana, 'todo')).toEqual([item.id])
  })

  it('leaves Inbox items when dismissing all', async () => {
    const { sana } = await people()
    const item = await sharedItem()
    await createNotification({
      purpose: 'ingestion_status',
      message: 'Finished',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })
    await sana.api.post('/api/notifications/dismiss-all').expect(204)
    expect(await ids(sana, 'todo')).toEqual([item.id])
    expect((await sana.api.get('/api/notifications').expect(200)).body.items).toEqual([])
  })
})

describe('refusals', () => {
  it.each([
    ['post', 'done'],
    ['delete', 'done'],
    ['post', 'restore'],
  ] as const)(
    'answers 404 for a malformed, unknown or invisible id on %s /:id/%s',
    async (method, action) => {
      const { sana, jide } = await people()
      const item = await sharedItem()
      await sana.api[method]('/api/notifications/not-an-id/' + action).expect(404)
      await sana.api[method]('/api/notifications/6ab39017e45cf009e4507731/' + action).expect(404)
      // An engineer cannot see an admin item, so cannot tick or restore it.
      await jide.api[method](`/api/notifications/${item.id}/${action}`).expect(404)
    },
  )

  it('answers 404 when ticking or unticking a bell item', async () => {
    const { sana } = await people()
    const bell = await createNotification({
      purpose: 'ingestion_status',
      message: 'Finished',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })
    await sana.api.post(`/api/notifications/${bell.id}/done`).expect(404)
    await sana.api.delete(`/api/notifications/${bell.id}/done`).expect(404)
  })

  it('does not tick an item someone has binned for themselves', async () => {
    const { sana } = await people()
    const item = await sharedItem()
    await sana.api.post(`/api/notifications/${item.id}/dismiss`).expect(204)
    await sana.api.post(`/api/notifications/${item.id}/done`).expect(404)
    expect(vi.isMockFunction(request)).toBe(false)
  })
})
