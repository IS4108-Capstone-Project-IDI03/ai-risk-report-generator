import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { KnowledgeGapRequestModel } from '../models/knowledge-gap-request.model'
import { NotificationModel } from '../models/notification.model'
import { UserModel } from '../models/user.model'
import * as notifications from '../services/notification.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

async function user(role: 'risk_engineer' | 'knowledge_admin', name: string, n: number) {
  const u = await UserModel.create({
    staffId: `T-${n}`,
    name,
    email: `u${n}@example.com`,
    role,
    active: true,
  })
  return { id: String(u._id), session: signedInAs(app, u) }
}

async function seedDoc(title: string, edition: string, createdAt: string) {
  const doc = await KnowledgeDocumentModel.create({
    title,
    edition,
    fileName: 'x.pdf',
    file: { key: 'k', contentType: 'application/pdf', size: 1, sha256: title },
    status: 'complete',
    metadata: { source_type: 'nfpa_standard' },
    createdAt: new Date(createdAt),
  })
  return String(doc._id)
}

async function setup() {
  const engineer = await user('risk_engineer', 'Jide Okafor', 1)
  const admin = await user('knowledge_admin', 'Sana Patel', 2)
  return { engineer, admin }
}

describe('POST /api/knowledge-gaps', () => {
  it('saves an engineer’s request and tells every admin', async () => {
    const { engineer } = await setup()
    const res = await engineer.session
      .post('/api/knowledge-gaps')
      .send({ question: 'What is the sprinkler density?', message: '  NFPA 13 please ' })
      .expect(201)

    expect(res.body).toMatchObject({
      question: 'What is the sprinkler density?',
      message: 'NFPA 13 please',
      askedBy: { id: engineer.id, name: 'Jide Okafor' },
      status: 'open',
    })
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt)
    const note = await NotificationModel.findOne().lean()
    expect(note).toMatchObject({
      purpose: 'knowledge_gap_request',
      message: 'New knowledge request',
      details: 'What is the sprinkler density?\nNFPA 13 please',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })
    expect(note?.context).toEqual({
      requestId: res.body.id,
      question: 'What is the sprinkler density?',
      askedBy: 'Jide Okafor',
      message: 'NFPA 13 please',
    })
  })

  it('leaves the message out when it is blank', async () => {
    const { engineer } = await setup()
    const res = await engineer.session
      .post('/api/knowledge-gaps')
      .send({ question: 'Q?', message: '   ' })
      .expect(201)
    expect(res.body).not.toHaveProperty('message')
  })

  it('refuses an admin', async () => {
    const { admin } = await setup()
    await admin.session.post('/api/knowledge-gaps').send({ question: 'Q?' }).expect(403)
  })

  it('rejects a blank, too-long or message-too-long body with field errors', async () => {
    const { engineer } = await setup()
    const post = (body: object) => engineer.session.post('/api/knowledge-gaps').send(body)
    expect((await post({ question: '  ' }).expect(400)).body.fields).toHaveProperty('question')
    expect((await post({ question: 'x'.repeat(4001) }).expect(400)).body.fields).toHaveProperty(
      'question',
    )
    expect(
      (await post({ question: 'Q', message: 'x'.repeat(1001) }).expect(400)).body.fields,
    ).toHaveProperty('message')
  })

  it('still saves the request when the notification fails', async () => {
    const { engineer } = await setup()
    vi.spyOn(notifications, 'createNotification').mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    await engineer.session.post('/api/knowledge-gaps').send({ question: 'Q?' }).expect(201)
    expect(await KnowledgeGapRequestModel.countDocuments()).toBe(1)
  })
})

describe('GET /api/knowledge-gaps', () => {
  it('lists open requests only, newest first, with the asker’s name', async () => {
    const { engineer, admin } = await setup()
    const old = await engineer.session.post('/api/knowledge-gaps').send({ question: 'Old' })
    await engineer.session.post('/api/knowledge-gaps').send({ question: 'New' })
    await admin.session.post(`/api/knowledge-gaps/${old.body.id}/dismiss`).send({ reason: 'No' })
    await engineer.session.post('/api/knowledge-gaps').send({ question: 'Newest' })

    const res = await admin.session.get('/api/knowledge-gaps').expect(200)
    expect(res.body.requests.map((r: { question: string }) => r.question)).toEqual([
      'Newest',
      'New',
    ])
    expect(res.body.requests[0].askedBy).toEqual({ id: engineer.id, name: 'Jide Okafor' })
  })

  it('refuses an engineer', async () => {
    const { engineer } = await setup()
    await engineer.session.get('/api/knowledge-gaps').expect(403)
  })
})

describe('POST /api/knowledge-gaps/:id/fill', () => {
  async function open() {
    const who = await setup()
    const req = await who.engineer.session.post('/api/knowledge-gaps').send({ question: 'Q?' })
    return { ...who, id: req.body.id as string }
  }

  it('closes the request and tells the asker each document’s title and upload date', async () => {
    const { engineer, admin, id } = await open()
    const a = await seedDoc('NFPA 13', '2022', '2026-10-20T08:00:00Z')
    const b = await seedDoc('FM DS 2-0', '2023', '2026-03-05T08:00:00Z')

    const res = await admin.session
      .post(`/api/knowledge-gaps/${id}/fill`)
      .send({ documentIds: [a, b] })
      .expect(200)

    expect(res.body).toMatchObject({ id, status: 'filled', askedBy: { name: 'Jide Okafor' } })
    const note = await NotificationModel.findOne({ targetRole: 'risk_engineer' }).lean()
    expect(note).toMatchObject({
      message: 'Your knowledge request was filled',
      details:
        'Q?\nNFPA 13 · Edition 2022 · uploaded 20 Oct 2026\nFM DS 2-0 · Edition 2023 · uploaded 5 Mar 2026',
      targetUserIds: [engineer.id],
    })
    expect(note?.context).toEqual({
      requestId: id,
      status: 'filled',
      question: 'Q?',
      documents: JSON.stringify([
        { title: 'NFPA 13', uploadedAt: '2026-10-20T08:00:00.000Z' },
        { title: 'FM DS 2-0', uploadedAt: '2026-03-05T08:00:00.000Z' },
      ]),
    })
    const list = await admin.session.get('/api/knowledge-gaps')
    expect(list.body.requests).toEqual([])
  })

  it('rejects no documents and unknown documents with a 400', async () => {
    const { admin, id } = await open()
    const fill = (documentIds: unknown) =>
      admin.session.post(`/api/knowledge-gaps/${id}/fill`).send({ documentIds })
    expect((await fill([]).expect(400)).body.fields).toHaveProperty('documentIds')
    await fill([String(new Types.ObjectId())]).expect(400)
    await fill(['nope']).expect(400)
    expect((await admin.session.get('/api/knowledge-gaps')).body.requests).toHaveLength(1)
  })

  it('answers 404 for an unknown request and 409 for a closed one', async () => {
    const { admin, id } = await open()
    const doc = await seedDoc('NFPA 13', '2022', '2026-10-20T08:00:00Z')
    const url = (i: string) => `/api/knowledge-gaps/${i}/fill`
    await admin.session
      .post(url(String(new Types.ObjectId())))
      .send({ documentIds: [doc] })
      .expect(404)
    await admin.session
      .post(url(id))
      .send({ documentIds: [doc] })
      .expect(200)
    const again = await admin.session
      .post(url(id))
      .send({ documentIds: [doc] })
      .expect(409)
    expect(again.body).toEqual({ error: 'This request was already closed.' })
  })

  it('refuses an engineer', async () => {
    const { engineer, id } = await open()
    await engineer.session
      .post(`/api/knowledge-gaps/${id}/fill`)
      .send({ documentIds: [] })
      .expect(403)
  })
})

describe('POST /api/knowledge-gaps/:id/dismiss', () => {
  it('needs a reason, then closes and tells the asker why', async () => {
    const { engineer, admin } = await setup()
    const { body } = await engineer.session.post('/api/knowledge-gaps').send({ question: 'Q?' })
    const url = `/api/knowledge-gaps/${body.id}/dismiss`

    const bad = await admin.session.post(url).send({ reason: '  ' }).expect(400)
    expect(bad.body.fields).toHaveProperty('reason')

    const res = await admin.session.post(url).send({ reason: 'Out of scope' }).expect(200)
    expect(res.body.status).toBe('dismissed')
    const note = await NotificationModel.findOne({ targetRole: 'risk_engineer' }).lean()
    expect(note).toMatchObject({
      message: 'Your knowledge request was dismissed',
      details: 'Q?\nReason: Out of scope',
      targetUserIds: [engineer.id],
    })
    expect(note?.context).toEqual({
      requestId: body.id,
      status: 'dismissed',
      question: 'Q?',
      reason: 'Out of scope',
    })

    await admin.session.post(url).send({ reason: 'Again' }).expect(409)
    await admin.session
      .post(`/api/knowledge-gaps/${new Types.ObjectId()}/dismiss`)
      .send({ reason: 'x' })
      .expect(404)
  })
})
