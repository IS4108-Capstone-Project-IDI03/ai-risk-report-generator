import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { config } from '../config'
import { NotificationModel } from '../models/notification.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// The configured service key, loaded the same way the middleware reads it, so
// the test stays correct whatever the environment sets it to.
const KEY = config.serviceApiKey ?? ''
const admin = signedInAsRole(app, 'knowledge_admin', 'Sana Patel')

const validBody = () => ({
  purpose: 'ingestion_status',
  message: 'FM Global 2-0 failed during chunking.',
  details: 'No text could be read from this PDF. Upload a copy with selectable text.',
  targetRole: 'knowledge_admin',
  targetUserIds: ['all'],
  context: { documentId: '6ab39017e45cf009e4507731', stage: 'chunking' },
  createdByService: 'ingestion-service',
})

const post = () => request(app).post('/api/internal/notifications')

describe('POST /api/internal/notifications auth', () => {
  it('creates a notification with the right key', async () => {
    const res = await post().set('x-service-key', KEY).send(validBody()).expect(201)

    expect(res.body.id).toMatch(/^[a-f0-9]{24}$/)
    expect(res.body.purpose).toBe('ingestion_status')
    expect(await NotificationModel.countDocuments({})).toBe(1)
  })

  it('rejects a request with no key and creates nothing', async () => {
    await post().send(validBody()).expect(401)
    expect(await NotificationModel.countDocuments({})).toBe(0)
  })

  it('rejects a wrong key and creates nothing', async () => {
    await post()
      .set('x-service-key', KEY + 'x')
      .send(validBody())
      .expect(401)
    expect(await NotificationModel.countDocuments({})).toBe(0)
  })

  // A session cookie is for the user-facing routes; it does not open this one.
  it('is not opened by a signed-in session', async () => {
    await admin.post('/api/internal/notifications').send(validBody()).expect(401)
    expect(await NotificationModel.countDocuments({})).toBe(0)
  })
})

describe('POST /api/internal/notifications validation', () => {
  it('rejects an unknown purpose with a field error', async () => {
    const res = await post()
      .set('x-service-key', KEY)
      .send({ ...validBody(), purpose: 'bogus' })
      .expect(400)
    expect(res.body.fields).toHaveProperty('purpose')
    expect(await NotificationModel.countDocuments({})).toBe(0)
  })

  it('rejects a missing message', async () => {
    const { message, ...body } = validBody()
    void message
    const res = await post().set('x-service-key', KEY).send(body).expect(400)
    expect(res.body.fields).toHaveProperty('message')
  })

  it('rejects a target role outside the agreed roles', async () => {
    const res = await post()
      .set('x-service-key', KEY)
      .send({ ...validBody(), targetRole: 'reviewer' })
      .expect(400)
    expect(res.body.fields).toHaveProperty('targetRole')
  })

  it('rejects an empty audience', async () => {
    const res = await post()
      .set('x-service-key', KEY)
      .send({ ...validBody(), targetUserIds: [] })
      .expect(400)
    expect(res.body.fields).toHaveProperty('targetUserIds')
  })
})

describe('POST /api/internal/notifications result', () => {
  it('is visible to the targeted role and not the other, through the user API', async () => {
    const engineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')

    await post().set('x-service-key', KEY).send(validBody()).expect(201)

    const adminList = await admin.get('/api/notifications').expect(200)
    expect(adminList.body.items).toHaveLength(1)
    expect(adminList.body.items[0].message).toBe('FM Global 2-0 failed during chunking.')

    const engineerList = await engineer.get('/api/notifications').expect(200)
    expect(engineerList.body.items).toEqual([])
  })

  it('records the service as author and no user', async () => {
    const res = await post().set('x-service-key', KEY).send(validBody()).expect(201)

    const stored = await NotificationModel.findById(res.body.id).lean()
    expect(stored!.createdByService).toBe('ingestion-service')
    expect(stored!.createdBy).toBeNull()
  })
})
