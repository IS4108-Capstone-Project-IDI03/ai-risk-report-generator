import { describe, expect, it } from 'vitest'
import app from '../index'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// CB-03: saved conversations behind /api/chat/conversations. Each engineer sees only their own.
const alex = signedInAsRole(app, 'risk_engineer', 'Alex')
const jide = signedInAsRole(app, 'risk_engineer', 'Jide')

// Starts a conversation the way OpenUI does: with the first question.
const start = (who: typeof alex, content: string) =>
  who.post('/api/chat/conversations').send({ message: { id: 'u1', role: 'user', content } })

describe('conversations (CB-03)', () => {
  it('saves a conversation named from the first question, trimmed to 60 characters (AC1)', async () => {
    const long = 'Where must sprinklers be fitted in a warehouse that stores plastics? '.repeat(3)
    const res = await start(alex, long)
    expect(res.status).toBe(201)
    expect(res.body.title).toBe(long.slice(0, 60).trim())
    const list = await alex.get('/api/chat/conversations')
    expect(list.body.threads.map((t: { id: string }) => t.id)).toEqual([res.body.id])
  })

  it('lists newest first and only my own conversations (AC2, AC7)', async () => {
    const first = await start(alex, 'First question')
    const second = await start(alex, 'Second question')
    await start(jide, 'Not yours')
    const list = await alex.get('/api/chat/conversations')
    expect(list.body.threads.map((t: { id: string }) => t.id)).toEqual([
      second.body.id,
      first.body.id,
    ])
  })

  it('shows the new name after a rename, and refuses an empty one (AC4)', async () => {
    const { body } = await start(alex, 'Old name')
    const bad = await alex.patch(`/api/chat/conversations/${body.id}`).send({ title: '   ' })
    expect(bad.status).toBe(400)
    const ok = await alex
      .patch(`/api/chat/conversations/${body.id}`)
      .send({ title: 'FM-200 notes' })
    expect(ok.body.title).toBe('FM-200 notes')
    const list = await alex.get('/api/chat/conversations')
    expect(list.body.threads[0].title).toBe('FM-200 notes')
  })

  it('removes a deleted conversation from the list (AC5)', async () => {
    const { body } = await start(alex, 'Delete me')
    expect((await alex.delete(`/api/chat/conversations/${body.id}`)).status).toBe(204)
    const list = await alex.get('/api/chat/conversations')
    expect(list.body.threads).toEqual([])
    expect((await alex.get(`/api/chat/conversations/${body.id}`)).status).toBe(404)
  })

  it("denies another user's conversation, whether read, renamed or deleted (AC7)", async () => {
    const { body } = await start(alex, 'Private')
    const url = `/api/chat/conversations/${body.id}`
    expect((await jide.get(url)).status).toBe(404)
    expect((await jide.patch(url).send({ title: 'Mine now' })).status).toBe(404)
    expect((await jide.delete(url)).status).toBe(404)
    expect((await alex.get(url)).status).toBe(200)
    expect((await alex.get('/api/chat/conversations/not-an-id')).status).toBe(404)
  })
})
