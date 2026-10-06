// End-to-end for the ingestion producer (IN-10, Task 8): the payload the
// ingestion worker posts to the internal endpoint becomes a notification the
// right admin sees through the user API — the one integration proving the two
// halves (Python worker, Node gateway) meet at a real contract.
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { config } from '../config'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// The internal endpoint fails closed without a configured key, which would
// turn every post below into a 401. Fail loudly here instead, so a missing
// SERVICE_API_KEY (e.g. in CI) is obvious rather than 14 mysterious 401s.
const KEY = config.serviceApiKey
if (!KEY) throw new Error('SERVICE_API_KEY must be set for the notification tests.')
const admin = signedInAsRole(app, 'knowledge_admin', 'Sana Patel')
const engineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')

const DOC_ID = '6ab39017e45cf009e4507731'

// The exact shape app/notifications.py builds for a failed ingestion.
const failurePayload = () => ({
  purpose: 'ingestion_status',
  message: '"NFPA 13 sprinkler standard" failed to ingest during chunking.',
  details: 'No text could be read from this PDF. Upload a copy with selectable text.',
  targetRole: 'knowledge_admin',
  targetUserIds: ['all'],
  context: { documentId: DOC_ID, status: 'failed', stage: 'chunking' },
  createdByService: 'ingestion-service',
})

const postFailure = (body: object = failurePayload()) =>
  request(app).post('/api/internal/notifications').set('x-service-key', KEY).send(body)

describe('ingestion failure → notification', () => {
  it('reaches a knowledge admin through the user API', async () => {
    await postFailure().expect(201)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items).toHaveLength(1)
    const item = res.body.items[0]
    expect(item.message).toBe('"NFPA 13 sprinkler standard" failed to ingest during chunking.')
    expect(item.details).toBe(
      'No text could be read from this PDF. Upload a copy with selectable text.',
    )
    expect(item.context).toEqual({ documentId: DOC_ID, status: 'failed', stage: 'chunking' })
  })

  it('is not shown to a risk engineer', async () => {
    await postFailure().expect(201)

    const res = await engineer.get('/api/notifications').expect(200)
    expect(res.body.items).toEqual([])
  })

  it('surfaces on the unread count the admin\u2019s session carries', async () => {
    await postFailure().expect(201)

    const res = await admin.get('/api/notifications/count').expect(200)
    expect(res.body).toEqual({ total: 1, unread: 1 })
  })

  it('carries the stage in the message so the admin knows where it broke', async () => {
    await postFailure().expect(201)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items[0].message).toContain('chunking')
  })

  // A stalled BullMQ job can re-run a document and reach a terminal state
  // twice; the same terminal event must not pile up duplicate rows.
  it('creates one notification when the same terminal event is posted twice', async () => {
    await postFailure().expect(201)
    await postFailure().expect(201)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items).toHaveLength(1)
  })

  it('still distinguishes a different document, or a different terminal status', async () => {
    await postFailure().expect(201)
    // Same document, now complete — a distinct event, so a second row.
    await postFailure({
      ...failurePayload(),
      message: '"NFPA 13 sprinkler standard" finished ingesting.',
      context: { documentId: DOC_ID, status: 'complete' },
    }).expect(201)
    // A different document failing — also distinct.
    await postFailure({
      ...failurePayload(),
      context: { documentId: '6ab39017e45cf009e4507799', status: 'failed', stage: 'parsing' },
    }).expect(201)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items).toHaveLength(3)
  })

  it('rejects an unknown purpose and lists nothing', async () => {
    await postFailure({ ...failurePayload(), purpose: 'bogus' }).expect(400)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items).toEqual([])
  })
})
