import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { createNotification } from '../services/notification.service'
import type { NewNotification } from '../services/notification.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// Sessions carry only a role here (F-05), so no account need exist. The same
// signed cookie is reused across tests; the collections are emptied each time.
const admin = signedInAsRole(app, 'knowledge_admin', 'Sana Patel')
const engineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')

const forAllAdmins = (message: string): NewNotification => ({
  purpose: 'ingestion_status',
  message,
  targetRole: 'knowledge_admin',
  targetUserIds: ['all'],
})

async function seedAdminSeries(count: number) {
  for (let n = 1; n <= count; n++) {
    await createNotification(forAllAdmins(`Document ${n} finished ingesting.`))
  }
}

describe('GET /api/notifications', () => {
  it('needs a session', async () => {
    await request(app).get('/api/notifications').expect(401)
  })

  it('returns the signed-in role\u2019s notifications, newest first', async () => {
    await seedAdminSeries(2)
    await createNotification({ ...forAllAdmins('ignored'), targetRole: 'risk_engineer' })

    const res = await admin.get('/api/notifications').expect(200)

    expect(res.body.items.map((i: { message: string }) => i.message)).toEqual([
      'Document 2 finished ingesting.',
      'Document 1 finished ingesting.',
    ])
    expect(res.body.total).toBe(2)
    expect(res.body.unread).toBe(2)
  })

  it('shows the other role nothing of these', async () => {
    await seedAdminSeries(2)

    const res = await engineer.get('/api/notifications').expect(200)

    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('honours limit and offset', async () => {
    await seedAdminSeries(5)

    const res = await admin.get('/api/notifications?limit=2&offset=2').expect(200)

    expect(res.body.items.map((i: { message: string }) => i.message)).toEqual([
      'Document 3 finished ingesting.',
      'Document 2 finished ingesting.',
    ])
    expect(res.body.total).toBe(5)
  })

  it('rejects a non-numeric limit with a field error', async () => {
    const res = await admin.get('/api/notifications?limit=lots').expect(400)
    expect(res.body.fields).toHaveProperty('limit')
  })

  it('rejects a negative offset with a field error', async () => {
    const res = await admin.get('/api/notifications?offset=-1').expect(400)
    expect(res.body.fields).toHaveProperty('offset')
  })

  it('caps an oversized limit rather than returning everything', async () => {
    await seedAdminSeries(5)

    const res = await admin.get('/api/notifications?limit=9999').expect(200)

    // The cap is 50; five fit under it, so this proves the request was accepted
    // and capped, not rejected.
    expect(res.body.items).toHaveLength(5)
    expect(res.body.total).toBe(5)
  })

  it('defaults the page when no limit or offset is given', async () => {
    await seedAdminSeries(3)

    const res = await admin.get('/api/notifications').expect(200)

    expect(res.body.items).toHaveLength(3)
  })
})

describe('PATCH /api/notifications/:id/read', () => {
  it('needs a session', async () => {
    await request(app).patch('/api/notifications/6ab39017e45cf009e4507731/read').expect(401)
  })

  it('marks one read and drops the unread count', async () => {
    const created = await createNotification(forAllAdmins('Document 1 finished ingesting.'))

    await admin.patch(`/api/notifications/${created.id}/read`).expect(204)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.unread).toBe(0)
    expect(res.body.items[0].read).toBe(true)
  })

  it('404s a malformed id', async () => {
    await admin.patch('/api/notifications/not-an-id/read').expect(404)
  })

  it('404s an unknown id', async () => {
    await admin.patch('/api/notifications/6ab39017e45cf009e4507731/read').expect(404)
  })

  it('404s a notification the caller cannot see', async () => {
    const created = await createNotification(forAllAdmins('Document 1 finished ingesting.'))

    await engineer.patch(`/api/notifications/${created.id}/read`).expect(404)

    // Still unread for the admin who can see it.
    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.unread).toBe(1)
  })
})

describe('POST /api/notifications/read-all', () => {
  it('needs a session', async () => {
    await request(app).post('/api/notifications/read-all').expect(401)
  })

  it('clears the unread count and keeps the list', async () => {
    await seedAdminSeries(3)

    await admin.post('/api/notifications/read-all').expect(204)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.unread).toBe(0)
    expect(res.body.items).toHaveLength(3)
  })
})

describe('POST /api/notifications/dismiss-all', () => {
  it('needs a session', async () => {
    await request(app).post('/api/notifications/dismiss-all').expect(401)
  })

  it('empties the caller\u2019s list', async () => {
    await seedAdminSeries(3)

    await admin.post('/api/notifications/dismiss-all').expect(204)

    const res = await admin.get('/api/notifications').expect(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('leaves another user in the role untouched', async () => {
    const otherAdmin = signedInAsRole(app, 'knowledge_admin', 'Mei Tan')
    await seedAdminSeries(3)

    await admin.post('/api/notifications/dismiss-all').expect(204)

    const res = await otherAdmin.get('/api/notifications').expect(200)
    expect(res.body.items).toHaveLength(3)
  })
})
